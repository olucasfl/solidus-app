import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CatchAllModule } from './common/catch-all.module';
import { AccessGuard } from './common/guards/access.guard';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './database/prisma.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      // O .env fica na raiz do monorepo, não em apps/api — pnpm roda a API com cwd=apps/api.
      envFilePath: ['../../.env'],
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    PrismaModule,
    HealthModule,
    // Último de propósito: só casa rota que nenhum módulo anterior casou (ver CatchAllModule).
    CatchAllModule,
  ],
  providers: [
    // Guards globais, executados nesta ordem: AccessGuard nega tudo sem @Public(), depois
    // ThrottlerGuard limita por IP. Módulos de negócio (auth, sync, categorização, taxa de
    // poupança...) entram aqui a partir da spec 01-fundacao-auth — ver ARCHITECTURE.md.
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
