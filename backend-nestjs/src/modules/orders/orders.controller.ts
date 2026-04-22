import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrderStatus, Role } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth-guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { QueryOrderDto } from './dto/query-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth('JWT-auth')
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new order' })
  @ApiResponse({ status: 201, type: OrderResponseDto })
  async create(
    @GetUser('id') userId: string,
    @Body() createOrderDto: CreateOrderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<OrderResponseDto> {
    return await this.ordersService.create(userId, createOrderDto, idempotencyKey);
  }

  @Get()
  @ApiOperation({ summary: 'Get current user orders' })
  async findMyOrders(@GetUser('id') userId: string, @Query() query: QueryOrderDto) {
    return await this.ordersService.findMyOrders(userId, query);
  }

  @Get('admin/all')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Admin: Get all orders' })
  async findAllForAdmin(@Query() query: QueryOrderDto) {
    return await this.ordersService.findAllForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order by id for current user' })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  async findOne(@Param('id') id: string, @GetUser('id') userId: string): Promise<OrderResponseDto> {
    return await this.ordersService.findOne(id, userId);
  }

  @Get('admin/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Admin: Get any order by id' })
  async findOneAdmin(@Param('id') id: string): Promise<OrderResponseDto> {
    return await this.ordersService.findOne(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update current user order status' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @GetUser('id') userId: string,
  ): Promise<OrderResponseDto> {
    return await this.ordersService.updateStatus(id, dto.status, userId);
  }

  @Patch('admin/:id/status')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Admin: Update any order status' })
  async updateStatusAdmin(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ): Promise<OrderResponseDto> {
    return await this.ordersService.updateStatus(id, dto.status);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel current user order' })
  async cancel(@Param('id') id: string, @GetUser('id') userId: string): Promise<OrderResponseDto> {
    return await this.ordersService.cancel(id, userId);
  }

  @Delete('admin/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Admin: Cancel any order' })
  async cancelAdmin(@Param('id') id: string): Promise<OrderResponseDto> {
    return await this.ordersService.cancel(id);
  }

  @Patch('admin/:id/ship')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Admin shortcut: set SHIPPED status' })
  async markShipped(@Param('id') id: string): Promise<OrderResponseDto> {
    return await this.ordersService.updateStatus(id, OrderStatus.SHIPPED);
  }
}
