import { Module } from '@nestjs/common';
import { PoupancaController } from './poupanca.controller';
import { PoupancaService } from './poupanca.service';

@Module({
  controllers: [PoupancaController],
  providers: [PoupancaService],
})
export class PoupancaModule {}
