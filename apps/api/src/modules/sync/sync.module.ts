import { Module } from '@nestjs/common';
import { PluggyGateway, PluggySdkGateway } from './pluggy.gateway';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { SyncTokenGuard } from './sync-token.guard';

@Module({
  controllers: [SyncController],
  providers: [SyncService, SyncTokenGuard, { provide: PluggyGateway, useClass: PluggySdkGateway }],
})
export class SyncModule {}
