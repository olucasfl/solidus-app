import type { SyncResponse, SyncStatusResponse } from '@solidus/shared';
import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { SYNC_THROTTLE_LIMIT, SYNC_THROTTLE_TTL_MS } from './sync.constants';
import { SyncService } from './sync.service';
import { SyncTokenGuard } from './sync-token.guard';

@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  // @Public() só para o AccessGuard de usuário: a chamada vem do cron externo, sem sessão (ADR 0005,
  // RULES §3). A rota NÃO é aberta — o SyncTokenGuard exige o SYNC_CRON_TOKEN.
  @Public()
  @UseGuards(SyncTokenGuard)
  @Throttle({ default: { limit: SYNC_THROTTLE_LIMIT, ttl: SYNC_THROTTLE_TTL_MS } })
  @Post()
  @HttpCode(HttpStatus.OK)
  sincronizar(): Promise<SyncResponse> {
    return this.syncService.sincronizar();
  }

  @Get('status')
  status(): Promise<SyncStatusResponse> {
    return this.syncService.status();
  }
}
