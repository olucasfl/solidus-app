import type { DefinirCategoriaResponse, ListaTransacoesResponse } from '@solidus/shared';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { UserId } from '../../common/decorators/user-id.decorator';
import { DefinirCategoriaDto, ListarTransacoesQuery } from './dto/transacoes.dto';
import { TransacoesService } from './transacoes.service';

// Tudo autenticado pelo guard global (nenhum @Public()).
@Controller('transacoes')
export class TransacoesController {
  constructor(private readonly transacoes: TransacoesService) {}

  @Get()
  listar(
    @UserId() userId: string,
    @Query() query: ListarTransacoesQuery,
  ): Promise<ListaTransacoesResponse> {
    return this.transacoes.listar(userId, query);
  }

  @Patch(':id/categoria')
  definirCategoria(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DefinirCategoriaDto,
  ): Promise<DefinirCategoriaResponse> {
    return this.transacoes.definirCategoria(userId, id, dto.categoria);
  }
}
