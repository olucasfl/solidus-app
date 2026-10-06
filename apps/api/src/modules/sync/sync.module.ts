import { Module } from '@nestjs/common';
import { CategorizacaoModule } from '../categorizacao/categorizacao.module';
import { RendaModule } from '../renda/renda.module';
import { ConexaoModule } from '../conexao/conexao.module';
import { PluggyModule } from './pluggy.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { SyncTokenGuard } from './sync-token.guard';

@Module({
  imports: [CategorizacaoModule, RendaModule, ConexaoModule, PluggyModule],
  controllers: [SyncController],
  providers: [SyncService, SyncTokenGuard],
})
export class SyncModule {}
