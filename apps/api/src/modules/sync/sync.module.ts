import { Module } from '@nestjs/common';
import { CategorizacaoModule } from '../categorizacao/categorizacao.module';
import { PluggyGateway, PluggySdkGateway } from './pluggy.gateway';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { SyncTokenGuard } from './sync-token.guard';

@Module({
  imports: [CategorizacaoModule],
  controllers: [SyncController],
  providers: [SyncService, SyncTokenGuard, { provide: PluggyGateway, useClass: PluggySdkGateway }],
})
export class SyncModule {}
