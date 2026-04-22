import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Category } from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from 'src/prisma/prisma.service';
import { CategoryResponseDto } from './dto/category-response.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { QueryCategoryDto } from './dto/query-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

type CategoryListResponse = {
  data: CategoryResponseDto[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
};

type CachedCategoryResponse = Omit<CategoryResponseDto, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

type CachedCategoryListResponse = {
  data: CachedCategoryResponse[];
  meta: CategoryListResponse['meta'];
};

@Injectable()
export class CategoryService {
  private readonly categoryListCacheTtlSeconds = 60;
  private readonly categoryDetailCacheTtlSeconds = 300;
  private readonly categoryListCachePrefix = 'categories:list';
  private readonly categoryIdCachePrefix = 'categories:id';
  private readonly categorySlugCachePrefix = 'categories:slug';

  constructor(
    private prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async create(createCategoryDto: CreateCategoryDto): Promise<CategoryResponseDto> {
    const { name, slug, ...rest } = createCategoryDto;
    const categorySlug = this.toSlug(slug ?? name);

    const existingCategory = await this.prisma.category.findUnique({
      where: { slug: categorySlug },
      select: { id: true },
    });

    if (existingCategory) {
      throw new ConflictException(`Category with slug "${categorySlug}" already exists`);
    }

    const category = await this.prisma.category.create({
      data: {
        name: name.trim(),
        slug: categorySlug,
        ...rest,
      },
    });

    const response = this.formatCategory(category, 0);
    await this.invalidateCategoryListCache();

    return response;
  }

  async findAll(queryDto: QueryCategoryDto): Promise<CategoryListResponse> {
    const { isActive, search, page = 1, limit = 10 } = queryDto;
    const where = this.buildWhereClause(isActive, search);
    const skip = (page - 1) * limit;
    const cacheKey = this.buildCategoryListCacheKey(isActive, search, page, limit);

    const cached = await this.getCache<CachedCategoryListResponse>(cacheKey);
    if (cached) {
      return this.reviveCategoryListResponse(cached);
    }

    const [total, categories] = await Promise.all([
      this.prisma.category.count({ where }),
      this.prisma.category.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { products: true },
          },
        },
      }),
    ]);

    const response = {
      data: categories.map((category) => this.formatCategory(category, category._count.products)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };

    await this.setCache(cacheKey, response, this.categoryListCacheTtlSeconds);

    return response;
  }

  async findOne(id: string): Promise<CategoryResponseDto> {
    const cacheKey = this.buildCategoryIdCacheKey(id);
    const cached = await this.getCache<CachedCategoryResponse>(cacheKey);
    if (cached) {
      return this.reviveCategoryResponse(cached);
    }

    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const response = this.formatCategory(category, category._count.products);
    await this.setCache(cacheKey, response, this.categoryDetailCacheTtlSeconds);

    return response;
  }

  async findBySlug(slug: string): Promise<CategoryResponseDto> {
    const normalizedSlug = slug.trim().toLowerCase();
    const cacheKey = this.buildCategorySlugCacheKey(normalizedSlug);
    const cached = await this.getCache<CachedCategoryResponse>(cacheKey);
    if (cached) {
      return this.reviveCategoryResponse(cached);
    }

    const category = await this.prisma.category.findUnique({
      where: { slug: normalizedSlug },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const response = this.formatCategory(category, category._count.products);
    await this.setCache(cacheKey, response, this.categoryDetailCacheTtlSeconds);

    return response;
  }

  async update(id: string, updateCategoryDto: UpdateCategoryDto): Promise<CategoryResponseDto> {
    const existingCategory = await this.prisma.category.findUnique({
      where: { id },
      select: { id: true, slug: true },
    });

    if (!existingCategory) {
      throw new NotFoundException('Category not found');
    }

    let nextSlug = updateCategoryDto.slug;
    if (nextSlug) {
      nextSlug = this.toSlug(nextSlug);
      if (nextSlug !== existingCategory.slug) {
        const slugTaken = await this.prisma.category.findUnique({
          where: { slug: nextSlug },
          select: { id: true },
        });
        if (slugTaken) {
          throw new ConflictException(`Category with slug "${nextSlug}" already exists`);
        }
      }
    }

    const updatedCategory = await this.prisma.category.update({
      where: { id },
      data: {
        ...updateCategoryDto,
        ...(nextSlug ? { slug: nextSlug } : {}),
      },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    const response = this.formatCategory(updatedCategory, updatedCategory._count.products);
    await this.invalidateCategoryCaches({
      id,
      slugs: [existingCategory.slug, updatedCategory.slug],
    });

    return response;
  }

  async remove(id: string): Promise<{ message: string }> {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    if (category._count.products > 0) {
      throw new BadRequestException(
        `Cannot delete category with ${category._count.products} products. Remove or reassign first`,
      );
    }

    await this.prisma.category.delete({
      where: { id },
    });
    await this.invalidateCategoryCaches({
      id,
      slugs: [category.slug],
    });

    return { message: 'Category deleted successfully' };
  }

  private buildCategoryListCacheKey(
    isActive: boolean | undefined,
    search: string | undefined,
    page: number,
    limit: number,
  ): string {
    const normalizedSearch = search?.trim().toLowerCase() ?? '';
    const activeState = isActive === undefined ? 'all' : String(isActive);
    return `${this.categoryListCachePrefix}:active=${activeState}:search=${normalizedSearch}:page=${page}:limit=${limit}`;
  }

  private buildCategoryIdCacheKey(id: string): string {
    return `${this.categoryIdCachePrefix}:${id}`;
  }

  private buildCategorySlugCacheKey(slug: string): string {
    return `${this.categorySlugCachePrefix}:${slug}`;
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

  private async invalidateCategoryListCache(): Promise<void> {
    await this.deleteKeysByPattern(`${this.categoryListCachePrefix}:*`);
  }

  private async invalidateCategoryCaches(params: { id?: string; slugs?: string[] }): Promise<void> {
    await this.invalidateCategoryListCache();

    const keysToDelete = new Set<string>();
    if (params.id) {
      keysToDelete.add(this.buildCategoryIdCacheKey(params.id));
    }
    for (const slug of params.slugs ?? []) {
      if (!slug) {
        continue;
      }
      keysToDelete.add(this.buildCategorySlugCacheKey(slug));
    }

    for (const key of keysToDelete) {
      await this.deleteCacheKey(key);
    }
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

  private reviveCategoryResponse(category: CachedCategoryResponse): CategoryResponseDto {
    return {
      ...category,
      createdAt: new Date(category.createdAt),
      updatedAt: new Date(category.updatedAt),
    };
  }

  private reviveCategoryListResponse(cached: CachedCategoryListResponse): CategoryListResponse {
    return {
      data: cached.data.map((category) => this.reviveCategoryResponse(category)),
      meta: cached.meta,
    };
  }

  private buildWhereClause(isActive?: boolean, search?: string) {
    const where: {
      isActive?: boolean;
      OR?: Array<
        | { name?: { contains: string; mode: 'insensitive' } }
        | { description?: { contains: string; mode: 'insensitive' } }
      >;
    } = {};

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

  private toSlug(value: string): string {
    const slug = value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]/g, '');

    if (!slug) {
      throw new BadRequestException('Slug cannot be empty after normalization');
    }

    return slug;
  }

  private formatCategory(category: Category, productCount: number): CategoryResponseDto {
    return {
      id: category.id,
      name: category.name,
      description: category.description,
      slug: category.slug,
      imageUrl: category.imageUrl,
      isActive: category.isActive,
      productCount,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    };
  }
}
