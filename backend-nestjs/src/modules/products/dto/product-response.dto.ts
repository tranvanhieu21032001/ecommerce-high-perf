import { ApiProperty } from '@nestjs/swagger';

export class ProductResponseDto {
  @ApiProperty({
    description: 'Product ID',
    example: 'e47a9df6-8a50-42e6-9c9b-0850d2df6d1f',
  })
  id: string;

  @ApiProperty({
    description: 'Product name',
    example: 'Wireless Headphones',
  })
  name: string;

  @ApiProperty({
    description: 'Product description',
    example: 'High quality wireless headphones',
    nullable: true,
  })
  description: string | null;

  @ApiProperty({
    description: 'Product price',
    example: 99.99,
  })
  price: number;

  @ApiProperty({
    description: 'Product stock',
    example: 100,
  })
  stock: number;

  @ApiProperty({
    description: 'Stock keeping unit',
    example: 'WH-001',
  })
  sku: string;

  @ApiProperty({
    description: 'Product image URL',
    example: 'https://example.com/image.jpg',
    nullable: true,
  })
  imageUrl: string | null;

  @ApiProperty({
    description: 'Product category',
    example: 'Electronics',
    nullable: true,
  })
  category: string | null;

  @ApiProperty({
    description: 'Product availability status',
    example: true,
  })
  isActive: boolean;

  @ApiProperty({
    description: 'Creation timestamp',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Last update timestamp',
  })
  updatedAt: Date;
}
