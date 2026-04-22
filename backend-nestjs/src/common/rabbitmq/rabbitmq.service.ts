import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

type AmqpChannel = {
  assertQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown>;
  sendToQueue: (queue: string, content: Buffer, options?: Record<string, unknown>) => boolean;
  consume: (
    queue: string,
    onMessage: (msg: { content: Buffer } | null) => void | Promise<void>,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
  ack: (msg: { content: Buffer }) => void;
  nack: (msg: { content: Buffer }, allUpTo?: boolean, requeue?: boolean) => void;
  close: () => Promise<void>;
};

type AmqpConnection = {
  createChannel: () => Promise<AmqpChannel>;
  close: () => Promise<void>;
};

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQService.name);
  private connection: AmqpConnection | null = null;
  private channel: AmqpChannel | null = null;

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.close();
  }

  async publish(queue: string, payload: unknown): Promise<void> {
    try {
      const channel = await this.getOrConnectChannel();
      await channel.assertQueue(queue, { durable: true });
      channel.sendToQueue(queue, Buffer.from(JSON.stringify(payload)), { persistent: true });
    } catch (error) {
      this.logger.warn(`Failed to publish message to "${queue}": ${(error as Error).message}`);
    }
  }

  async consume(queue: string, handler: (payload: unknown) => Promise<void>): Promise<void> {
    try {
      const channel = await this.getOrConnectChannel();
      await channel.assertQueue(queue, { durable: true });

      await channel.consume(
        queue,
        async (msg) => {
          if (!msg) {
            return;
          }
          try {
            const payload = JSON.parse(msg.content.toString()) as unknown;
            await handler(payload);
            channel.ack(msg);
          } catch (error) {
            this.logger.error(`Error while consuming "${queue}": ${(error as Error).message}`);
            channel.nack(msg, false, false);
          }
        },
        { noAck: false },
      );
    } catch (error) {
      this.logger.warn(`Failed to consume queue "${queue}": ${(error as Error).message}`);
    }
  }

  private async connect(): Promise<void> {
    if (this.channel) {
      return;
    }

    try {
      const amqpLib = require('amqplib') as {
        connect: (url: string) => Promise<AmqpConnection>;
      };
      const url = process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';
      this.connection = await amqpLib.connect(url);
      this.channel = await this.connection.createChannel();
      this.logger.log(`RabbitMQ connected (${url})`);
    } catch (error) {
      this.logger.warn(`RabbitMQ connection skipped: ${(error as Error).message}`);
    }
  }

  private async getOrConnectChannel(): Promise<AmqpChannel> {
    if (!this.channel) {
      await this.connect();
    }
    if (!this.channel) {
      throw new Error('RabbitMQ channel is not available');
    }
    return this.channel;
  }

  private async close(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
    } catch {
      // noop
    } finally {
      this.channel = null;
      this.connection = null;
    }
  }
}
