import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/common/decorators/roles.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth-guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { CreateFlashSaleDto } from './dto/create-flash-sale.dto';
import { FlashSaleResponseDto } from './dto/flash-sale-response.dto';
import { UpdateFlashSaleDto } from './dto/update-flash-sale.dto';
import { FlashSalesService } from './flash-sales.service';

@ApiTags('flash-sales')
@Controller('flash-sales')
export class FlashSalesController {
  constructor(private readonly flashSalesService: FlashSalesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create a flash sale rule (Admin only)' })
  @ApiResponse({ status: 201, type: FlashSaleResponseDto })
  async create(@Body() createDto: CreateFlashSaleDto): Promise<FlashSaleResponseDto> {
    return await this.flashSalesService.create(createDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all flash sale rules' })
  @ApiResponse({ status: 200, type: [FlashSaleResponseDto] })
  async findAll(): Promise<FlashSaleResponseDto[]> {
    return await this.flashSalesService.findAll();
  }

  @Get('active')
  @ApiOperation({ summary: 'Get active flash sale rules' })
  @ApiResponse({ status: 200, type: [FlashSaleResponseDto] })
  async findActive(): Promise<FlashSaleResponseDto[]> {
    return await this.flashSalesService.findActive();
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update flash sale rule (Admin only)' })
  @ApiResponse({ status: 200, type: FlashSaleResponseDto })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateFlashSaleDto,
  ): Promise<FlashSaleResponseDto> {
    return await this.flashSalesService.update(id, updateDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete flash sale rule (Admin only)' })
  @ApiResponse({ status: 200, schema: { example: { message: 'Flash sale deleted successfully' } } })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    return await this.flashSalesService.remove(id);
  }
}
