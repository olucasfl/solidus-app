import { Module } from '@nestjs/common';
import { CarteiraModule } from '../carteira/carteira.module';
import { ReservaModule } from '../reserva/reserva.module';
import { EnvelopesController } from './envelopes.controller';
import { EnvelopesService } from './envelopes.service';

@Module({
  imports: [CarteiraModule, ReservaModule],
  controllers: [EnvelopesController],
  providers: [EnvelopesService],
})
export class EnvelopesModule {}
