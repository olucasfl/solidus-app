import type { HistoricoPoupancaResponse, PoupancaMes } from '@solidus/shared';
import { Controller, Get, Query } from '@nestjs/common';
import { HistoricoQuery, PoupancaQuery } from './dto/poupanca.dto';
import { PoupancaService } from './poupanca.service';

// Tudo autenticado pelo guard global (nenhum @Public()).
@Controller('poupanca')
export class PoupancaController {
  constructor(private readonly poupanca: PoupancaService) {}

  @Get()
  mes(@Query() query: PoupancaQuery): Promise<PoupancaMes> {
    return this.poupanca.mes(query.mes);
  }

  @Get('historico')
  historico(@Query() query: HistoricoQuery): Promise<HistoricoPoupancaResponse> {
    return this.poupanca.historico(query.meses);
  }
}
