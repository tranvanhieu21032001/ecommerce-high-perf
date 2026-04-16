import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class AppService {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}
  async onModuleInit() {
    await this.redis.set('test_key', 'Redis is working!');
    const val = await this.redis.get('test_key');
    console.log('>>> Check Redis:', val);
  }
  getHello(): string {
    return 'Hello World!';
  }
}
