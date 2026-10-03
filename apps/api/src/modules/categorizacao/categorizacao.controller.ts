import {
  CATEGORIAS,
  type Categoria,
  type RecalcularResponse,
  type RegraCategoria,
} from '@solidus/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CategorizacaoService } from './categorizacao.service';
import { CriarRegraDto } from './dto/criar-regra.dto';

// Tudo autenticado pelo guard global (nenhum @Public()).
@Controller()
export class CategorizacaoController {
  constructor(private readonly categorizacao: CategorizacaoService) {}

  @Get('categorias')
  categorias(): readonly Categoria[] {
    return CATEGORIAS;
  }

  @Get('regras')
  listarRegras(): Promise<RegraCategoria[]> {
    return this.categorizacao.listarRegras();
  }

  @Post('regras')
  criarRegra(@Body() dto: CriarRegraDto): Promise<RegraCategoria> {
    return this.categorizacao.criarRegra(dto);
  }

  @Delete('regras/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removerRegra(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.categorizacao.removerRegra(id);
  }

  @Post('categorizacao/recalcular')
  @HttpCode(HttpStatus.OK)
  recalcular(): Promise<RecalcularResponse> {
    return this.categorizacao.recalcular();
  }
}
