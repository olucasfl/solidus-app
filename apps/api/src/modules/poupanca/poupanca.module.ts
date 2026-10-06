import { Module } from '@nestjs/common';
import { PoupancaController } from './poupanca.controller';
import { PoupancaService } from './poupanca.service';

@Module({
  controllers: [PoupancaController],
  providers: [PoupancaService],
  // A reserva de emergência (spec reserva-emergencia) lê o gasto por mês daqui.
  exports: [PoupancaService],
})
export class PoupancaModule {}
