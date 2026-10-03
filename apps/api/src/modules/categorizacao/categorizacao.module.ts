import { Module } from '@nestjs/common';
import { CategorizacaoController } from './categorizacao.controller';
import { CategorizacaoService } from './categorizacao.service';

@Module({
  controllers: [CategorizacaoController],
  providers: [CategorizacaoService],
  exports: [CategorizacaoService],
})
export class CategorizacaoModule {}
