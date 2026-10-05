import { Module } from '@nestjs/common';
import { CategorizacaoModule } from '../categorizacao/categorizacao.module';
import { RendaFontesController, SalarioController } from './renda.controller';
import { RendaService } from './renda.service';

@Module({
  imports: [CategorizacaoModule],
  controllers: [SalarioController, RendaFontesController],
  providers: [RendaService],
  exports: [RendaService],
})
export class RendaModule {}
