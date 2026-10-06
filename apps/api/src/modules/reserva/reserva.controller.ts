import type { ConfiguracaoReserva, ReservaEmergenciaResponse } from '@solidus/shared';
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { UserId } from '../../common/decorators/user-id.decorator';
import { AtualizarConfiguracaoReservaDto } from './dto/reserva.dto';
import { ReservaService } from './reserva.service';

// Tudo autenticado pelo guard global (nenhum @Public()); o dono é sempre o usuário da sessão.
@Controller('reserva-emergencia')
export class ReservaController {
  constructor(private readonly reserva: ReservaService) {}

  @Get()
  obter(@UserId() userId: string): Promise<ReservaEmergenciaResponse> {
    return this.reserva.obter(userId);
  }

  @Patch('configuracao')
  atualizarConfiguracao(
    @UserId() userId: string,
    @Body() dto: AtualizarConfiguracaoReservaDto,
  ): Promise<ConfiguracaoReserva> {
    return this.reserva.atualizarConfiguracao(userId, dto);
  }
}
