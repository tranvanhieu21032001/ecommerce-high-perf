import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FlashSalesModule } from '../flash-sales/flash-sales.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [PrismaModule, FlashSalesModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
