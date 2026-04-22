import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Order, OrderItem, OrderStatus, Prisma, Product, User } from '@prisma/client';
import Redis from 'ioredis';
import { RabbitMQService } from 'src/common/rabbitmq/rabbitmq.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { FlashSalesService } from '../flash-sales/flash-sales.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { QueryOrderDto } from './dto/query-order.dto';
import { ORDER_CREATED_QUEUE, OrderCreatedEvent } from './orders.events';

type OrderWithRelations = Order & {
  orderItems: (OrderItem & { product: Product })[];
  user: User;
};

@Injectable()
export class OrdersService {
  private readonly idempotencyTtlSeconds = 600;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQService: RabbitMQService,
    private readonly flashSalesService: FlashSalesService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async create(
    userId: string,
    createOrderDto: CreateOrderDto,
    idempotencyKey?: string,
  ): Promise<OrderResponseDto> {
    const redisKey = this.buildIdempotencyKey(userId, idempotencyKey);
    if (redisKey) {
      const cached = await this.getIdempotentResult(redisKey);
      if (cached) {
        return cached;
      }
    }

    const normalizedItems = this.aggregateItems(createOrderDto);
    const productIds = normalizedItems.map((item) => item.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { category: true },
    });

    if (products.length !== productIds.length) {
      throw new NotFoundException('One or more products were not found');
    }

    const productMap = new Map(products.map((p) => [p.id, p]));
    const activeRules = await this.flashSalesService.getActiveRulesRaw();

    const lineItems = normalizedItems.map((item) => {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new NotFoundException(`Product ${item.productId} not found`);
      }
      const rule = this.flashSalesService.findBestDiscount(
        activeRules,
        product.id,
        product.categoryId,
      );
      const unitPrice = rule
        ? Number((Number(product.price) * (1 - rule.discountPercent / 100)).toFixed(2))
        : Number(product.price);

      return {
        product,
        quantity: item.quantity,
        unitPrice,
      };
    });

    const totalAmount = lineItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

    const order = await this.prisma.$transaction(async (tx) => {
      for (const item of lineItems) {
        const result = await tx.product.updateMany({
          where: {
            id: item.product.id,
            stock: { gte: item.quantity },
          },
          data: {
            stock: { decrement: item.quantity },
          },
        });
        if (result.count === 0) {
          throw new BadRequestException(`Insufficient stock for product "${item.product.name}"`);
        }
      }

      const created = await tx.order.create({
        data: {
          userId,
          status: OrderStatus.PENDING,
          totalAmount: new Prisma.Decimal(totalAmount),
          shippingAddress: createOrderDto.shippingAddress ?? null,
          orderItems: {
            create: lineItems.map((item) => ({
              productId: item.product.id,
              quantity: item.quantity,
              price: new Prisma.Decimal(item.unitPrice),
            })),
          },
        },
        include: {
          orderItems: {
            include: {
              product: true,
            },
          },
          user: true,
        },
      });

      return created;
    });

    const response = this.mapOrder(order);
    await this.publishOrderCreated(order);

    if (redisKey) {
      await this.setIdempotentResult(redisKey, response);
    }

    return response;
  }

  async findMyOrders(userId: string, query: QueryOrderDto) {
    const where: Prisma.OrderWhereInput = { userId };
    if (query.status) {
      where.status = query.status;
    }
    if (query.search?.trim()) {
      where.OR = [
        { id: { contains: query.search.trim(), mode: 'insensitive' } },
        { orderNumber: { contains: query.search.trim(), mode: 'insensitive' } },
      ];
    }

    return await this.findByWhere(where, query.page, query.limit);
  }

  async findAllForAdmin(query: QueryOrderDto) {
    const where: Prisma.OrderWhereInput = {};
    if (query.status) {
      where.status = query.status;
    }
    if (query.search?.trim()) {
      where.OR = [
        { id: { contains: query.search.trim(), mode: 'insensitive' } },
        { orderNumber: { contains: query.search.trim(), mode: 'insensitive' } },
      ];
    }

    return await this.findByWhere(where, query.page, query.limit);
  }

  async findOne(id: string, userId?: string): Promise<OrderResponseDto> {
    const where: Prisma.OrderWhereInput = userId ? { id, userId } : { id };
    const order = await this.prisma.order.findFirst({
      where,
      include: {
        orderItems: {
          include: {
            product: true,
          },
        },
        user: true,
      },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return this.mapOrder(order);
  }

  async updateStatus(id: string, status: OrderStatus, userId?: string): Promise<OrderResponseDto> {
    const existing = await this.prisma.order.findFirst({
      where: userId ? { id, userId } : { id },
      include: {
        orderItems: true,
      },
    });
    if (!existing) {
      throw new NotFoundException('Order not found');
    }

    if (existing.status === OrderStatus.CANCELLED && status !== OrderStatus.CANCELLED) {
      throw new BadRequestException('Cancelled order cannot transition to another status');
    }

    const updated = await this.prisma.order.update({
      where: { id },
      data: { status },
      include: {
        orderItems: {
          include: {
            product: true,
          },
        },
        user: true,
      },
    });

    return this.mapOrder(updated);
  }

  async cancel(id: string, userId?: string): Promise<OrderResponseDto> {
    const existing = await this.prisma.order.findFirst({
      where: userId ? { id, userId } : { id },
      include: {
        orderItems: true,
      },
    });
    if (!existing) {
      throw new NotFoundException('Order not found');
    }
    if (existing.status !== OrderStatus.PENDING && existing.status !== OrderStatus.PROCESSING) {
      throw new BadRequestException('Only pending/processing orders can be cancelled');
    }

    const cancelled = await this.prisma.$transaction(async (tx) => {
      for (const item of existing.orderItems) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });
      }

      return await tx.order.update({
        where: { id },
        data: { status: OrderStatus.CANCELLED },
        include: {
          orderItems: {
            include: {
              product: true,
            },
          },
          user: true,
        },
      });
    });

    return this.mapOrder(cancelled);
  }

  private async findByWhere(where: Prisma.OrderWhereInput, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          orderItems: {
            include: {
              product: true,
            },
          },
          user: true,
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: orders.map((order) => this.mapOrder(order)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private aggregateItems(createOrderDto: CreateOrderDto) {
    const map = new Map<string, number>();
    for (const item of createOrderDto.items) {
      const prev = map.get(item.productId) ?? 0;
      map.set(item.productId, prev + item.quantity);
    }
    return Array.from(map.entries()).map(([productId, quantity]) => ({
      productId,
      quantity,
    }));
  }

  private mapOrder(order: OrderWithRelations): OrderResponseDto {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      userId: order.userId,
      status: order.status,
      totalAmount: Number(order.totalAmount),
      shippingAddress: order.shippingAddress,
      items: order.orderItems.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        quantity: item.quantity,
        price: Number(item.price),
        subtotal: Number(item.price) * item.quantity,
      })),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  private async publishOrderCreated(order: OrderWithRelations): Promise<void> {
    const event: OrderCreatedEvent = {
      orderId: order.id,
      orderNumber: order.orderNumber,
      userEmail: order.user.email,
      totalAmount: Number(order.totalAmount),
      itemCount: order.orderItems.length,
    };
    await this.rabbitMQService.publish(ORDER_CREATED_QUEUE, event);
  }

  private buildIdempotencyKey(userId: string, idempotencyKey?: string): string | null {
    if (!idempotencyKey?.trim()) {
      return null;
    }
    return `orders:idempotency:${userId}:${idempotencyKey.trim()}`;
  }

  private async getIdempotentResult(key: string): Promise<OrderResponseDto | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as Omit<OrderResponseDto, 'createdAt' | 'updatedAt'> & {
        createdAt: string;
        updatedAt: string;
      };
      return {
        ...parsed,
        createdAt: new Date(parsed.createdAt),
        updatedAt: new Date(parsed.updatedAt),
      };
    } catch {
      return null;
    }
  }

  private async setIdempotentResult(key: string, order: OrderResponseDto): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(order), 'EX', this.idempotencyTtlSeconds);
    } catch {
      // noop
    }
  }
}
