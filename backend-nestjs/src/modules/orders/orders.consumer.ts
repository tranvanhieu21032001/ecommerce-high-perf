import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EmailService } from 'src/common/email/email.service';
import { RabbitMQService } from 'src/common/rabbitmq/rabbitmq.service';
import { ORDER_CREATED_QUEUE, OrderCreatedEvent } from './orders.events';

@Injectable()
export class OrdersConsumer implements OnModuleInit {
  private readonly logger = new Logger(OrdersConsumer.name);

  constructor(
    private readonly rabbitMQService: RabbitMQService,
    private readonly emailService: EmailService,
  ) {}

  async onModuleInit() {
    await this.rabbitMQService.consume(ORDER_CREATED_QUEUE, async (payload) => {
      const event = payload as OrderCreatedEvent;
      if (!event?.userEmail || !event?.orderNumber) {
        this.logger.warn('Invalid order.created payload, skipped');
        return;
      }

      await this.emailService.sendOrderConfirmation({
        to: event.userEmail,
        orderNumber: event.orderNumber,
        totalAmount: event.totalAmount,
        itemCount: event.itemCount,
      });
    });
  }
}
