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
  Patch,
  Post,
} from '@nestjs/common';
import { UserId } from '../../common/decorators/user-id.decorator';
import { CategorizacaoService } from './categorizacao.service';
import { AtualizarRegraDto } from './dto/atualizar-regra.dto';
import { CriarRegraDto } from './dto/criar-regra.dto';

// Tudo autenticado pelo guard global (nenhum @Public()); o dono é sempre o usuário da sessão.
@Controller()
export class CategorizacaoController {
  constructor(private readonly categorizacao: CategorizacaoService) {}

  @Get('categorias')
  categorias(): readonly Categoria[] {
    return CATEGORIAS;
  }

  @Get('regras')
  listarRegras(@UserId() userId: string): Promise<RegraCategoria[]> {
    return this.categorizacao.listarRegras(userId);
  }

  @Post('regras')
  criarRegra(@UserId() userId: string, @Body() dto: CriarRegraDto): Promise<RegraCategoria> {
    return this.categorizacao.criarRegra(userId, dto);
  }

  @Patch('regras/:id')
  atualizarRegra(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarRegraDto,
  ): Promise<RegraCategoria> {
    return this.categorizacao.atualizarRegra(userId, id, dto);
  }

  @Delete('regras/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removerRegra(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.categorizacao.removerRegra(userId, id);
  }

  @Post('categorizacao/recalcular')
  @HttpCode(HttpStatus.OK)
  recalcular(@UserId() userId: string): Promise<RecalcularResponse> {
    return this.categorizacao.recalcular(userId);
  }
}
