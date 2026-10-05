import type { FonteDto, SalarioResponse, TrocarFonteSalarioResponse } from '@solidus/shared';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { UserId } from '../../common/decorators/user-id.decorator';
import { AtivarFonteDto, TransacaoFonteDto } from './dto/renda.dto';
import { RendaService } from './renda.service';

// Tudo autenticado pelo guard global (nenhum @Public()); o dono é sempre o usuário da sessão.
@Controller('salario')
export class SalarioController {
  constructor(private readonly renda: RendaService) {}

  @Get()
  salario(@UserId() userId: string): Promise<SalarioResponse> {
    return this.renda.salario(userId);
  }

  /** "Esse pagamento é o meu salário": adiciona uma fonte sem encerrar as outras. */
  @Post('fonte')
  definirFonte(@UserId() userId: string, @Body() dto: TransacaoFonteDto): Promise<FonteDto> {
    return this.renda.definirFonteSalario(userId, dto.transacaoId);
  }

  /** "Trocar de onde vem": encerra ESTA fonte e abre a nova a partir da data da transação. */
  @Patch('fontes/:id/trocar')
  trocar(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransacaoFonteDto,
  ): Promise<TrocarFonteSalarioResponse> {
    return this.renda.trocarFonteSalario(userId, id, dto.transacaoId);
  }
}

@Controller('renda/fontes')
export class RendaFontesController {
  constructor(private readonly renda: RendaService) {}

  @Get()
  listar(@UserId() userId: string): Promise<FonteDto[]> {
    return this.renda.listarFontes(userId);
  }

  @Patch(':id')
  ativar(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtivarFonteDto,
  ): Promise<FonteDto> {
    return this.renda.ativarFonte(userId, id, dto.ativa);
  }
}
