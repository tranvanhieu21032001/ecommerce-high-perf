import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from 'src/prisma/prisma.service';
import { randomUUID } from 'crypto';
import { CreateFlashSaleDto } from './dto/create-flash-sale.dto';
import { FlashSaleResponseDto } from './dto/flash-sale-response.dto';
import { UpdateFlashSaleDto } from './dto/update-flash-sale.dto';

export type FlashSaleRule = {
  id: string;
  name: string;
  discountPercent: number;
  productId: string | null;
  categoryId: string | null;
  startAt: string;
  endAt: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class FlashSalesService {
  private readonly redisKey = 'flashsales:rules';

  constructor(
    private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async create(createDto: CreateFlashSaleDto): Promise<FlashSaleResponseDto> {
    await this.validateRuleTargets(createDto.productId, createDto.categoryId);
    this.validateTimeWindow(createDto.startAt, createDto.endAt);

    const now = new Date().toISOString();
    const rule: FlashSaleRule = {
      id: randomUUID(),
      name: createDto.name.trim(),
      discountPercent: createDto.discountPercent,
      productId: createDto.productId ?? null,
      categoryId: createDto.categoryId ?? null,
      startAt: createDto.startAt,
      endAt: createDto.endAt,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    const rules = await this.getAllRulesRaw();
    rules.push(rule);
    await this.saveRules(rules);

    return this.toResponse(rule);
  }

  async findAll(): Promise<FlashSaleResponseDto[]> {
    const rules = await this.getAllRulesRaw();
    return rules.map((rule) => this.toResponse(rule));
  }

  async findActive(): Promise<FlashSaleResponseDto[]> {
    const now = new Date();
    const active = (await this.getAllRulesRaw()).filter((rule) => this.isRuleActive(rule, now));
    return active.map((rule) => this.toResponse(rule));
  }

  async update(id: string, updateDto: UpdateFlashSaleDto): Promise<FlashSaleResponseDto> {
    const rules = await this.getAllRulesRaw();
    const idx = rules.findIndex((r) => r.id === id);
    if (idx === -1) {
      throw new NotFoundException('Flash sale not found');
    }

    const existing = rules[idx];
    const merged: FlashSaleRule = {
      ...existing,
      ...updateDto,
      productId:
        updateDto.productId !== undefined ? updateDto.productId : existing.productId,
      categoryId:
        updateDto.categoryId !== undefined ? updateDto.categoryId : existing.categoryId,
      updatedAt: new Date().toISOString(),
    } as FlashSaleRule;

    await this.validateRuleTargets(merged.productId ?? undefined, merged.categoryId ?? undefined);
    this.validateTimeWindow(merged.startAt, merged.endAt);

    rules[idx] = merged;
    await this.saveRules(rules);

    return this.toResponse(merged);
  }

  async remove(id: string): Promise<{ message: string }> {
    const rules = await this.getAllRulesRaw();
    const next = rules.filter((r) => r.id !== id);
    if (next.length === rules.length) {
      throw new NotFoundException('Flash sale not found');
    }
    await this.saveRules(next);
    return { message: 'Flash sale deleted successfully' };
  }

  async getActiveRulesRaw(): Promise<FlashSaleRule[]> {
    const now = new Date();
    return (await this.getAllRulesRaw()).filter((rule) => this.isRuleActive(rule, now));
  }

  findBestDiscount(
    rules: FlashSaleRule[],
    productId: string,
    categoryId: string,
  ): FlashSaleRule | null {
    const matched = rules.filter(
      (rule) =>
        (rule.productId && rule.productId === productId) ||
        (rule.categoryId && rule.categoryId === categoryId),
    );
    if (matched.length === 0) {
      return null;
    }
    return matched.sort((a, b) => b.discountPercent - a.discountPercent)[0];
  }

  private async validateRuleTargets(productId?: string, categoryId?: string): Promise<void> {
    if (!productId && !categoryId) {
      throw new BadRequestException('Either productId or categoryId is required');
    }

    if (productId) {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        select: { id: true },
      });
      if (!product) {
        throw new NotFoundException('Product not found');
      }
    }

    if (categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: categoryId },
        select: { id: true },
      });
      if (!category) {
        throw new NotFoundException('Category not found');
      }
    }
  }

  private validateTimeWindow(startAt: string, endAt: string): void {
    const start = new Date(startAt);
    const end = new Date(endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid flash sale time window');
    }
    if (end <= start) {
      throw new BadRequestException('endAt must be greater than startAt');
    }
  }

  private isRuleActive(rule: FlashSaleRule, now: Date): boolean {
    return (
      rule.isActive &&
      new Date(rule.startAt).getTime() <= now.getTime() &&
      now.getTime() <= new Date(rule.endAt).getTime()
    );
  }

  private async getAllRulesRaw(): Promise<FlashSaleRule[]> {
    try {
      const raw = await this.redis.get(this.redisKey);
      if (!raw) {
        return [];
      }
      return JSON.parse(raw) as FlashSaleRule[];
    } catch {
      return [];
    }
  }

  private async saveRules(rules: FlashSaleRule[]): Promise<void> {
    await this.redis.set(this.redisKey, JSON.stringify(rules));
  }

  private toResponse(rule: FlashSaleRule): FlashSaleResponseDto {
    return {
      ...rule,
      startAt: new Date(rule.startAt),
      endAt: new Date(rule.endAt),
      createdAt: new Date(rule.createdAt),
      updatedAt: new Date(rule.updatedAt),
    };
  }
}
