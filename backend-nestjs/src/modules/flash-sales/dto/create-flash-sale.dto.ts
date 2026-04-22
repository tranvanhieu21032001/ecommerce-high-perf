import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateFlashSaleDto {
  @ApiProperty({ example: 'Weekend Electronics Blast' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 20, minimum: 1, maximum: 90 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(90)
  discountPercent: number;

  @ApiPropertyOptional({ example: 'b84f74f8-75fa-4f8f-a2bd-74c5cfcd6e42' })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional({ example: 'b84f74f8-75fa-4f8f-a2bd-74c5cfcd6e99' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiProperty({ example: '2026-04-22T10:00:00.000Z' })
  @IsDateString()
  startAt: string;

  @ApiProperty({ example: '2026-04-23T10:00:00.000Z' })
  @IsDateString()
  endAt: string;
}
