import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Category, Prisma, Product } from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

type ProductListResponse = {
  data: ProductResponseDto[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
};

type CachedProductResponse = Omit<ProductResponseDto, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

type CachedProductListResponse = {
  data: CachedProductResponse[];
  meta: ProductListResponse['meta'];
};

@Injectable()
export class ProductsService {
  private readonly productListCacheTtlSeconds = 60;
  private readonly productDetailCacheTtlSeconds = 300;
  private readonly productListCachePrefix = 'products:list';
  private readonly productIdCachePrefix = 'products:id';

  constructor(
    private prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async create(createProductDto: CreateProductDto): Promise<ProductResponseDto> {
    const existingSku = await this.prisma.product.findUnique({
      where: { sku: createProductDto.sku },
      select: { id: true },
    });
    if (existingSku) {
      throw new ConflictException(`Product with SKU ${createProductDto.sku} already exists`);
    }

    await this.ensureCategoryExists(createProductDto.categoryId);

    const product = await this.prisma.product.create({
      data: {
        ...createProductDto,
        price: new Prisma.Decimal(createProductDto.price),
      },
      include: {
        category: true,
      },
    });

    const response = this.formatProduct(product);
    await this.invalidateProductListCache();
    return response;
  }

  async findAll(queryDto: QueryProductDto): Promise<ProductListResponse> {
    const { category, isActive, search, page = 1, limit = 10 } = queryDto;
    const where = this.buildWhereClause(queryDto);
    const skip = (page - 1) * limit;
    const cacheKey = this.buildProductListCacheKey(category, isActive, search, page, limit);

    const cached = await this.getCache<CachedProductListResponse>(cacheKey);
    if (cached) {
      return this.reviveProductListResponse(cached);
    }

    const [total, products] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          category: true,
        },
      }),
    ]);

    const response = {
      data: products.map((product) => this.formatProduct(product)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };

    await this.setCache(cacheKey, response, this.productListCacheTtlSeconds);
    return response;
  }

  async findOne(id: string): Promise<ProductResponseDto> {
    const cacheKey = this.buildProductIdCacheKey(id);
    const cached = await this.getCache<CachedProductResponse>(cacheKey);
    if (cached) {
      return this.reviveProductResponse(cached);
    }

    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
      },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const response = this.formatProduct(product);
    await this.setCache(cacheKey, response, this.productDetailCacheTtlSeconds);
    return response;
  }

  async update(id: string, updateProductDto: UpdateProductDto): Promise<ProductResponseDto> {
    const existingProduct = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true, sku: true },
    });

    if (!existingProduct) {
      throw new NotFoundException('Product not found');
    }

    if (updateProductDto.sku && updateProductDto.sku !== existingProduct.sku) {
      const skuTaken = await this.prisma.product.findUnique({
        where: { sku: updateProductDto.sku },
        select: { id: true },
      });
      if (skuTaken) {
        throw new ConflictException(`Product with SKU ${updateProductDto.sku} already exists`);
      }
    }

    if (updateProductDto.categoryId) {
      await this.ensureCategoryExists(updateProductDto.categoryId);
    }

    const updateData: Prisma.ProductUpdateInput = { ...updateProductDto };
    if (updateProductDto.price !== undefined) {
      updateData.price = new Prisma.Decimal(updateProductDto.price);
    }

    const updatedProduct = await this.prisma.product.update({
      where: { id },
      data: updateData,
      include: {
        category: true,
      },
    });

    const response = this.formatProduct(updatedProduct);
    await this.invalidateProductCaches(id);
    return response;
  }

  async updateStock(id: string, quantity: number): Promise<ProductResponseDto> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true, stock: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const newStock = product.stock + quantity;
    if (newStock < 0) {
      throw new BadRequestException('Insufficient stock');
    }

    const updatedProduct = await this.prisma.product.update({
      where: { id },
      data: { stock: newStock },
      include: {
        category: true,
      },
    });

    const response = this.formatProduct(updatedProduct);
    await this.invalidateProductCaches(id);
    return response;
  }

  async remove(id: string): Promise<{ message: string }> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        orderItems: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (product.orderItems.length > 0) {
      throw new BadRequestException(
        'Cannot delete product that is part of existing orders. Consider marking it as inactive only',
      );
    }

    await this.prisma.product.delete({
      where: { id },
    });

    await this.invalidateProductCaches(id);
    return { message: 'Product deleted successfully' };
  }

  private buildWhereClause(queryDto: QueryProductDto): Prisma.ProductWhereInput {
    const { category, isActive, search } = queryDto;
    const where: Prisma.ProductWhereInput = {};

    if (category) {
      where.categoryId = category;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (search?.trim()) {
      const keyword = search.trim();
      where.OR = [
        { name: { contains: keyword, mode: 'insensitive' } },
        { description: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  private buildProductListCacheKey(
    category: string | undefined,
    isActive: boolean | undefined,
    search: string | undefined,
    page: number,
    limit: number,
  ): string {
    const normalizedCategory = category?.trim().toLowerCase() ?? 'all';
    const activeState = isActive === undefined ? 'all' : String(isActive);
    const normalizedSearch = search?.trim().toLowerCase() ?? '';
    return `${this.productListCachePrefix}:category=${normalizedCategory}:active=${activeState}:search=${normalizedSearch}:page=${page}:limit=${limit}`;
  }

  private buildProductIdCacheKey(id: string): string {
    return `${this.productIdCachePrefix}:${id}`;
  }

  private async getCache<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.redis.get(key);
      if (!cached) {
        return null;
      }
      return JSON.parse(cached) as T;
    } catch {
      return null;
    }
  }

  private async setCache(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      // Fail-open: cache errors should not fail API responses
    }
  }

  private async deleteCacheKey(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch {
      // Fail-open: cache invalidation errors should not fail API responses
    }
  }

  private async invalidateProductListCache(): Promise<void> {
    await this.deleteKeysByPattern(`${this.productListCachePrefix}:*`);
  }

  private async invalidateProductCaches(id: string): Promise<void> {
    await this.invalidateProductListCache();
    await this.deleteCacheKey(this.buildProductIdCacheKey(id));
  }

  private async deleteKeysByPattern(pattern: string): Promise<void> {
    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', '100');
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch {
      // Fail-open: cache invalidation errors should not fail API responses
    }
  }

  private reviveProductResponse(product: CachedProductResponse): ProductResponseDto {
    return {
      ...product,
      createdAt: new Date(product.createdAt),
      updatedAt: new Date(product.updatedAt),
    };
  }

  private reviveProductListResponse(cached: CachedProductListResponse): ProductListResponse {
    return {
      data: cached.data.map((product) => this.reviveProductResponse(product)),
      meta: cached.meta,
    };
  }

  private async ensureCategoryExists(categoryId: string): Promise<void> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
  }

  private formatProduct(product: Product & { category: Category | null }): ProductResponseDto {
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      price: Number(product.price),
      stock: product.stock,
      sku: product.sku,
      imageUrl: product.imageUrl,
      category: product.category?.name ?? null,
      isActive: product.isActive,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }
}
