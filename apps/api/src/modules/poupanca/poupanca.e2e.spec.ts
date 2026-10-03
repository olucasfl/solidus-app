import { type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { AccessGuard } from '../../common/guards/access.guard';
import { ApiThrottlerGuard } from '../../common/guards/api-throttler.guard';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { PrismaModule } from '../../database/prisma.module';
import { PrismaService } from '../../database/prisma.service';
import { PoupancaModule } from './poupanca.module';

const SEGREDO_JWT = 'segredo-de-teste-para-access-token-32ch';

describe('GET /poupanca e /poupanca/historico (e2e)', () => {
  let app: INestApplication;
  let auth: string;
  const prisma = { transacao: { groupBy: jest.fn().mockResolvedValue([]) } };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ NODE_ENV: 'test', JWT_ACCESS_SECRET: SEGREDO_JWT })],
        }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
        JwtModule.register({}),
        PrismaModule,
        PoupancaModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_GUARD, useClass: ApiThrottlerGuard },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    auth = `Bearer ${await moduleRef
      .get(JwtService, { strict: false })
      .signAsync({ sub: 'user-1' }, { secret: SEGREDO_JWT, expiresIn: 300 })}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => prisma.transacao.groupBy.mockClear());

  const http = () => request(app.getHttpServer());

  it('CA-09: sem access token → 401', async () => {
    expect((await http().get('/poupanca?mes=2026-09')).status).toBe(401);
    expect((await http().get('/poupanca/historico')).status).toBe(401);
  });

  it.each([[''], ['?mes='], ['?mes=2026-13'], ['?mes=2026-9'], ['?mes=abc'], ['?mes=2026-09-01']])(
    'CA-09: /poupanca%s → 400 sem consultar o banco',
    async (query) => {
      const r = await http().get(`/poupanca${query}`).set('Authorization', auth);

      expect(r.status).toBe(400);
      expect(prisma.transacao.groupBy).not.toHaveBeenCalled();
    },
  );

  it('CA-09: mês válido → 200 com o contrato', async () => {
    const r = await http().get('/poupanca?mes=2026-09').set('Authorization', auth);

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      mes: '2026-09',
      taxaBasisPoints: null,
      avisos: ['SEM_TRANSACOES', 'SEM_RECEITA'],
    });
  });

  it.each([['meses=0'], ['meses=25'], ['meses=abc'], ['meses=1.5'], ['meses=-3']])(
    'CA-11: /poupanca/historico?%s → 400',
    async (query) => {
      const r = await http().get(`/poupanca/historico?${query}`).set('Authorization', auth);

      expect(r.status).toBe(400);
      expect(prisma.transacao.groupBy).not.toHaveBeenCalled();
    },
  );

  it('CA-11: historico padrão tem 6 meses; meses=24 tem 24', async () => {
    const padrao = await http().get('/poupanca/historico').set('Authorization', auth);
    const todos = await http().get('/poupanca/historico?meses=24').set('Authorization', auth);

    expect(padrao.status).toBe(200);
    expect(padrao.body.meses).toHaveLength(6);
    expect(todos.body.meses).toHaveLength(24);
  });
});
