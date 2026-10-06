import { type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtModule } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { ThrottlerModule, ThrottlerStorage, type ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { AccessGuard } from '../../common/guards/access.guard';
import { ApiThrottlerGuard } from '../../common/guards/api-throttler.guard';
import { PrismaModule } from '../../database/prisma.module';
import { PrismaService } from '../../database/prisma.service';
import { PluggyGateway } from './pluggy.gateway';
import { PluggyIndisponivelError } from './sync-errors';
import { SyncModule } from './sync.module';

const TOKEN = 'c'.repeat(64);
const SEGREDO_JWT = 'segredo-de-teste-para-access-token-32ch';

function ambiente(extra: Record<string, unknown> = {}) {
  return {
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: SEGREDO_JWT,
    SYNC_CRON_TOKEN: TOKEN,
    PLUGGY_ITEM_ID: 'item-1',
    SEED_USER_EMAIL: 'dono@exemplo.com',
    ...extra,
  };
}

async function montar(env: Record<string, unknown>) {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1' }) },
    conta: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ id: 'conta-1' }),
    },
    transacao: {
      aggregate: jest.fn().mockResolvedValue({ _max: { data: null } }),
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn(),
    },
    syncRun: { create: jest.fn().mockResolvedValue(undefined), findFirst: jest.fn() },
    conexaoPluggy: { upsert: jest.fn().mockResolvedValue(undefined) },
  };
  const gateway = {
    listarContas: jest.fn().mockResolvedValue([]),
    listarTransacoes: jest.fn().mockResolvedValue([]),
    listarItem: jest.fn().mockResolvedValue({
      statusItem: 'UPDATED',
      statusExecucao: 'SUCCESS',
      consentimentoExpiraEm: null,
      ultimaAtualizacaoEm: null,
      proximaAtualizacaoEm: null,
      autoSyncDesativadoEm: null,
      falhasDeLogin: 0,
      acaoPendente: false,
    }),
  };

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => env] }),
      ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
      JwtModule.register({}),
      PrismaModule,
      SyncModule,
    ],
    providers: [
      { provide: APP_GUARD, useClass: AccessGuard },
      { provide: APP_GUARD, useClass: ApiThrottlerGuard },
    ],
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(PluggyGateway)
    .useValue(gateway)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  return { app, moduleRef, prisma, gateway };
}

function limparThrottler(moduleRef: TestingModule): void {
  const storage = moduleRef.get<ThrottlerStorageService>(ThrottlerStorage, { strict: false });
  storage.storage.clear();
  (storage as unknown as { hitExpirations: Map<string, unknown> }).hitExpirations.clear();
}

describe('POST /sync e GET /sync/status (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: Awaited<ReturnType<typeof montar>>['prisma'];
  let gateway: Awaited<ReturnType<typeof montar>>['gateway'];

  beforeAll(async () => {
    ({ app, moduleRef, prisma, gateway } = await montar(ambiente()));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    limparThrottler(moduleRef);
    gateway.listarContas.mockReset().mockResolvedValue([]);
  });

  it('CA-09: sem token, token curto e token errado dão 401 SYNC_TOKEN_INVALIDO idêntico e não tocam o gateway', async () => {
    const sem = await request(app.getHttpServer()).post('/sync');
    const curto = await request(app.getHttpServer()).post('/sync').set('x-sync-token', 'x');
    const errado = await request(app.getHttpServer())
      .post('/sync')
      .set('x-sync-token', 'd'.repeat(64));

    for (const r of [sem, curto, errado]) {
      expect(r.status).toBe(401);
      expect(r.body.code).toBe('SYNC_TOKEN_INVALIDO');
    }
    expect(sem.body).toEqual(curto.body);
    expect(curto.body).toEqual(errado.body);
    expect(gateway.listarContas).not.toHaveBeenCalled();
  });

  it('token certo: 200 com os contadores', async () => {
    const r = await request(app.getHttpServer()).post('/sync').set('x-sync-token', TOKEN);

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      contas: 0,
      transacoesNovas: 0,
      transacoesAtualizadas: 0,
      semConversao: 0,
    });
    expect(typeof r.body.duracaoMs).toBe('number');
  });

  it('CA-11: falha do Pluggy dá 502 genérico, sem vazar o texto original', async () => {
    gateway.listarContas.mockRejectedValue(new PluggyIndisponivelError());

    const r = await request(app.getHttpServer()).post('/sync').set('x-sync-token', TOKEN);

    expect(r.status).toBe(502);
    expect(r.body.code).toBe('PLUGGY_INDISPONIVEL');
  });

  it('CA-10: sync simultâneo dá 409', async () => {
    let liberar!: () => void;
    gateway.listarContas.mockReturnValue(
      new Promise((resolve) => {
        liberar = () => resolve([]);
      }),
    );

    const primeiro = request(app.getHttpServer())
      .post('/sync')
      .set('x-sync-token', TOKEN)
      .then((r) => r);
    await new Promise((r) => setTimeout(r, 100));
    const segundo = await request(app.getHttpServer()).post('/sync').set('x-sync-token', TOKEN);
    liberar();

    expect(segundo.status).toBe(409);
    expect(segundo.body.code).toBe('SYNC_EM_ANDAMENTO');
    expect((await primeiro).status).toBe(200);
  });

  it('CA-14: /sync/status exige access token e devolve null sem nenhum sync', async () => {
    prisma.syncRun.findFirst.mockResolvedValue(null);
    const sem = await request(app.getHttpServer()).get('/sync/status');
    const jwt = await moduleRef
      .get(JwtService, { strict: false })
      .signAsync({ sub: 'user-1' }, { secret: SEGREDO_JWT, expiresIn: 60 });
    const com = await request(app.getHttpServer())
      .get('/sync/status')
      .set('Authorization', `Bearer ${jwt}`);

    expect(sem.status).toBe(401);
    expect(com.status).toBe(200);
    expect(com.body).toEqual({ ultimoSync: null });
  });

  it('o token do sync não abre rotas de usuário', async () => {
    const r = await request(app.getHttpServer()).get('/sync/status').set('x-sync-token', TOKEN);

    expect(r.status).toBe(401);
  });

  it('CA-15: a 6ª chamada no mesmo minuto é 429 LIMITE_TENTATIVAS', async () => {
    for (let i = 0; i < 5; i += 1) {
      const r = await request(app.getHttpServer()).post('/sync').set('x-sync-token', TOKEN);
      expect(r.status).toBe(200);
    }
    const sexta = await request(app.getHttpServer()).post('/sync').set('x-sync-token', TOKEN);

    expect(sexta.status).toBe(429);
    expect(sexta.body.code).toBe('LIMITE_TENTATIVAS');
  });
});

describe('POST /sync sem PLUGGY_ITEM_ID (e2e)', () => {
  it('CA-12: 503 PLUGGY_NAO_CONFIGURADO e o gateway não é chamado', async () => {
    const { app, gateway } = await montar(ambiente({ PLUGGY_ITEM_ID: '' }));

    const r = await request(app.getHttpServer()).post('/sync').set('x-sync-token', TOKEN);

    expect(r.status).toBe(503);
    expect(r.body.code).toBe('PLUGGY_NAO_CONFIGURADO');
    expect(gateway.listarContas).not.toHaveBeenCalled();
    await app.close();
  });
});
