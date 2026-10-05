import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { CatchAllModule } from './common/catch-all.module';
import { AccessGuard } from './common/guards/access.guard';
import { ApiThrottlerGuard } from './common/guards/api-throttler.guard';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './database/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { CarteiraModule } from './modules/carteira/carteira.module';
import { CategorizacaoModule } from './modules/categorizacao/categorizacao.module';
import { HealthModule } from './modules/health/health.module';
import { PoupancaModule } from './modules/poupanca/poupanca.module';
import { RendaModule } from './modules/renda/renda.module';
import { SyncModule } from './modules/sync/sync.module';
import { TransacoesModule } from './modules/transacoes/transacoes.module';

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
    // Sem secret default: cada assinatura/verificação (access token vs. refresh) passa o próprio
    // segredo na chamada (`auth.service.ts`, `access.guard.ts`) — dois segredos, um JwtService.
    JwtModule.register({}),
    PrismaModule,
    AuthModule,
    HealthModule,
    SyncModule,
    CategorizacaoModule,
    TransacoesModule,
    PoupancaModule,
    RendaModule,
    CarteiraModule,
    // Último de propósito: só casa rota que nenhum módulo anterior casou (ver CatchAllModule).
    CatchAllModule,
  ],
  providers: [
    // Guards globais, executados nesta ordem: AccessGuard nega tudo sem @Public() e valida o
    // access token (spec 01-fundacao-auth), depois ApiThrottlerGuard limita por IP. Módulos de
    // negócio (sync, categorização, taxa de poupança...) entram aqui a partir da spec deles.
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_GUARD, useClass: ApiThrottlerGuard },
  ],
})
export class AppModule {}
