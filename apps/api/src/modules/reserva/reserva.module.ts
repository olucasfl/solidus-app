import { Module } from '@nestjs/common';
import { CarteiraModule } from '../carteira/carteira.module';
import { PoupancaModule } from '../poupanca/poupanca.module';
import { ReservaController } from './reserva.controller';
import { ReservaService } from './reserva.service';

@Module({
  imports: [PoupancaModule, CarteiraModule],
  controllers: [ReservaController],
  providers: [ReservaService],
  // Os envelopes (spec envelopes) leem a reserva e a meta daqui.
  exports: [ReservaService],
})
export class ReservaModule {}
