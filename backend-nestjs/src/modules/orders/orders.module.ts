import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FlashSalesModule } from '../flash-sales/flash-sales.module';
import { OrdersConsumer } from './orders.consumer';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [PrismaModule, FlashSalesModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersConsumer],
})
export class OrdersModule {}
