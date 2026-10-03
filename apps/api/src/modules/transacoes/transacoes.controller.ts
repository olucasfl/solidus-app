import type { DefinirCategoriaResponse, ListaTransacoesResponse } from '@solidus/shared';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { DefinirCategoriaDto, ListarTransacoesQuery } from './dto/transacoes.dto';
import { TransacoesService } from './transacoes.service';

// Tudo autenticado pelo guard global (nenhum @Public()).
@Controller('transacoes')
export class TransacoesController {
  constructor(private readonly transacoes: TransacoesService) {}

  @Get()
  listar(@Query() query: ListarTransacoesQuery): Promise<ListaTransacoesResponse> {
    return this.transacoes.listar(query);
  }

  @Patch(':id/categoria')
  definirCategoria(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DefinirCategoriaDto,
  ): Promise<DefinirCategoriaResponse> {
    return this.transacoes.definirCategoria(id, dto.categoria);
  }
}
