import { Module } from '@nestjs/common';
import { PluggyModule } from '../sync/pluggy.module';
import { ConexaoController } from './conexao.controller';
import { ConexaoService } from './conexao.service';

@Module({
  imports: [PluggyModule],
  controllers: [ConexaoController],
  providers: [ConexaoService],
  exports: [ConexaoService],
})
export class ConexaoModule {}
