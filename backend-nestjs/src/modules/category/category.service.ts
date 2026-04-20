import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Category } from '@prisma/client';
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

@Injectable()
export class CategoryService {
  constructor(private prisma: PrismaService) {}

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

    return this.formatCategory(category, 0);
  }

  async findAll(queryDto: QueryCategoryDto): Promise<CategoryListResponse> {
    const { isActive, search, page = 1, limit = 10 } = queryDto;
    const where = this.buildWhereClause(isActive, search);
    const skip = (page - 1) * limit;

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

    return {
      data: categories.map((category) => this.formatCategory(category, category._count.products)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string): Promise<CategoryResponseDto> {
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

    return this.formatCategory(category, category._count.products);
  }

  async findBySlug(slug: string): Promise<CategoryResponseDto> {
    const category = await this.prisma.category.findUnique({
      where: { slug },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return this.formatCategory(category, category._count.products);
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

    return this.formatCategory(updatedCategory, updatedCategory._count.products);
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

    return { message: 'Category deleted successfully' };
  }

  private buildWhereClause(isActive?: boolean, search?: string) {
    const where: {
      isActive?: boolean;
      OR?: Array<{ name?: { contains: string; mode: 'insensitive' } } | { description?: { contains: string; mode: 'insensitive' } }>;
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
