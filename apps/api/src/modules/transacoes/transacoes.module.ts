import { Module } from '@nestjs/common';
import { CategorizacaoModule } from '../categorizacao/categorizacao.module';
import { TransacoesController } from './transacoes.controller';
import { TransacoesService } from './transacoes.service';

@Module({
  imports: [CategorizacaoModule],
  controllers: [TransacoesController],
  providers: [TransacoesService],
})
export class TransacoesModule {}
