import { ApiProperty } from '@nestjs/swagger';

export class FlashSaleResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  discountPercent: number;

  @ApiProperty({ nullable: true })
  productId: string | null;

  @ApiProperty({ nullable: true })
  categoryId: string | null;

  @ApiProperty()
  startAt: Date;

  @ApiProperty()
  endAt: Date;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
