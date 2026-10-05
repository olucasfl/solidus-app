import type { HistoricoPoupancaResponse, PoupancaMes } from '@solidus/shared';
import { Controller, Get, Query } from '@nestjs/common';
import { UserId } from '../../common/decorators/user-id.decorator';
import { HistoricoQuery, PoupancaQuery } from './dto/poupanca.dto';
import { PoupancaService } from './poupanca.service';

// Tudo autenticado pelo guard global (nenhum @Public()).
@Controller('poupanca')
export class PoupancaController {
  constructor(private readonly poupanca: PoupancaService) {}

  @Get()
  mes(@UserId() userId: string, @Query() query: PoupancaQuery): Promise<PoupancaMes> {
    return this.poupanca.mes(userId, query.mes);
  }

  @Get('historico')
  historico(
    @UserId() userId: string,
    @Query() query: HistoricoQuery,
  ): Promise<HistoricoPoupancaResponse> {
    return this.poupanca.historico(userId, query.meses);
  }
}
