import { type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { ThrottlerModule, ThrottlerStorage, type ThrottlerStorageService } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AccessGuard } from '../../common/guards/access.guard';
import { ApiThrottlerGuard } from '../../common/guards/api-throttler.guard';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { PrismaModule } from '../../database/prisma.module';
import { PrismaService } from '../../database/prisma.service';
import { AuthModule } from './auth.module';
import { REFRESH_TOKEN_COOKIE_NAME } from './auth.constants';

/**
 * Sem `validateEnv`/`.env` real de propósito: este teste nunca deve depender do `.env` da raiz
 * (RULES.md §8) nem do `AUTH_REGISTRATION_OPEN` etc. — só as variáveis que `AccessGuard`/
 * `AuthService` realmente leem.
 */
const ENV_TESTE = {
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: 'segredo-de-teste-para-access-token-32ch',
};

function buildPrismaMock() {
  return {
    user: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    refreshSession: {
      create: jest.fn().mockResolvedValue(undefined),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

async function buildApp(
  prismaMock: unknown,
): Promise<{ app: INestApplication; moduleRef: TestingModule }> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ENV_TESTE] }),
      ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
      JwtModule.register({}),
      PrismaModule,
      AuthModule,
    ],
    providers: [
      { provide: APP_GUARD, useClass: AccessGuard },
      { provide: APP_GUARD, useClass: ApiThrottlerGuard },
    ],
  })
    .overrideProvider(PrismaService)
    .useValue(prismaMock)
    .compile();

  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  // Mesmo pipe/filtro de `app.setup.ts` — sem isto o DTO não valida nada no teste (CA-05).
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  return { app, moduleRef };
}

/** Limpa o contador do throttler entre testes — sem isto, os 5/min de `/auth/login` (CA-15) são
 * um orçamento COMPARTILHADO por todos os `it()` que chamam login na mesma `describe`, e os
 * testes depois do 5º call acabam vendo 429 em vez do que estão de fato testando. */
function limparThrottler(moduleRef: TestingModule): void {
  const storage = moduleRef.get<ThrottlerStorageService>(ThrottlerStorage, { strict: false });
  storage.storage.clear();
  // `storage` (público) não é o único estado: `hitExpirations` é um Map privado separado que
  // `pruneExpiredHits` usa pra RECONSTRUIR o contador mesmo depois do `storage.clear()` — sem
  // limpar os dois, a próxima chamada "ressuscita" os hits antigos dentro do mesmo TTL.
  (storage as unknown as { hitExpirations: Map<string, unknown> }).hitExpirations.clear();
}

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  const prismaMock = buildPrismaMock();
  let senhaHash: string;

  beforeAll(async () => {
    senhaHash = await argon2.hash('senha-forte-123');
    ({ app, moduleRef } = await buildApp(prismaMock));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    limparThrottler(moduleRef);
    prismaMock.refreshSession.create.mockResolvedValue(undefined);
    prismaMock.refreshSession.update.mockResolvedValue(undefined);
    prismaMock.refreshSession.updateMany.mockResolvedValue({ count: 1 });
  });

  it('CA-01 — login certo: 200 com accessToken + usuario, cookie httpOnly com o refresh', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'ana@exemplo.com',
      senhaHash,
    });

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'ana@exemplo.com', senha: 'senha-forte-123' });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toBeDefined();
    expect(response.body.usuario).toEqual({ id: 'user-1', email: 'ana@exemplo.com' });

    const cookies = (response.headers['set-cookie'] ?? []) as unknown as string[];
    const refreshCookie = cookies.find((c) => c.startsWith(`${REFRESH_TOKEN_COOKIE_NAME}=`));
    expect(refreshCookie).toContain('HttpOnly');
  });

  it('CA-03/04 — senha errada e e-mail inexistente dão o mesmo corpo de erro', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-1',
      email: 'ana@exemplo.com',
      senhaHash,
    });
    const senhaErrada = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'ana@exemplo.com', senha: 'senha-errada' });

    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    const emailInexistente = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'naoexiste@exemplo.com', senha: 'qualquer-coisa' });

    expect(senhaErrada.status).toBe(401);
    expect(emailInexistente.status).toBe(401);
    expect(senhaErrada.body).toEqual(emailInexistente.body);
    expect(senhaErrada.body.code).toBe('AUTH_CREDENCIAIS_INVALIDAS');
  });

  it('CA-05 — payload inválido: 400 com o campo problemático', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nao-e-email', senha: '' });

    expect(response.status).toBe(400);
  });

  it('CA-11 — GET /auth/me sem Authorization: 401 (guard global)', async () => {
    const response = await request(app.getHttpServer()).get('/auth/me');

    expect(response.status).toBe(401);
  });

  it('CA-12/13 — access token válido devolve o usuário; token inválido dá 401', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'ana@exemplo.com',
      senhaHash,
    });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'ana@exemplo.com', senha: 'senha-forte-123' });

    prismaMock.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-1', email: 'ana@exemplo.com' });
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    expect(me.status).toBe(200);
    expect(me.body).toEqual({ id: 'user-1', email: 'ana@exemplo.com' });

    const comTokenInvalido = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer token-que-nao-existe');

    expect(comTokenInvalido.status).toBe(401);
  });

  it('CA-07 — refresh sem cookie: 401 AUTH_SESSAO_INVALIDA', async () => {
    const response = await request(app.getHttpServer()).post('/auth/refresh');

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('AUTH_SESSAO_INVALIDA');
  });

  it('CA-06/08 — refresh rotaciona o cookie; o cookie antigo (reuso) depois dá 401', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'ana@exemplo.com',
      senhaHash,
    });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'ana@exemplo.com', senha: 'senha-forte-123' });
    const cookieAntigo = extrairCookieRefresh(login);

    const sessaoCriada = {
      id: 'sessao-1',
      userId: 'user-1',
      cliente: 'WEB',
      revogadoEm: null,
      expiraEm: new Date(Date.now() + 1000 * 60),
    };
    prismaMock.refreshSession.findFirst.mockResolvedValueOnce(sessaoCriada);

    const refresh = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookieAntigo);

    expect(refresh.status).toBe(200);
    expect(refresh.body.accessToken).toBeDefined();

    // Reuso: a mesma sessão, já marcada como revogada pela chamada acima.
    prismaMock.refreshSession.findFirst.mockResolvedValueOnce({
      ...sessaoCriada,
      revogadoEm: new Date(),
    });
    const reuso = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookieAntigo);

    expect(reuso.status).toBe(401);
    expect(reuso.body.code).toBe('AUTH_SESSAO_INVALIDA');
  });

  it('CA-14 — logout revoga a sessão e limpa o cookie', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'ana@exemplo.com',
      senhaHash,
    });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'ana@exemplo.com', senha: 'senha-forte-123' });
    const cookie = extrairCookieRefresh(login);

    const logout = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .set('Cookie', cookie);

    expect(logout.status).toBe(204);
    expect(prismaMock.refreshSession.updateMany).toHaveBeenCalled();
    const cookies = (logout.headers['set-cookie'] ?? []) as unknown as string[];
    expect(cookies.some((c) => c.startsWith(`${REFRESH_TOKEN_COOKIE_NAME}=;`))).toBe(true);
  });
});

describe('Auth (e2e) — limite de tentativas de login', () => {
  let app: INestApplication;
  const prismaMock = buildPrismaMock();

  beforeAll(async () => {
    ({ app } = await buildApp(prismaMock));
    prismaMock.user.findUnique.mockResolvedValue(null);
  });

  afterAll(async () => {
    await app.close();
  });

  it('CA-15 — a 6ª tentativa no mesmo minuto é 429 LIMITE_TENTATIVAS', async () => {
    for (let tentativa = 0; tentativa < 5; tentativa += 1) {
      const resposta = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: `tentativa${tentativa}@exemplo.com`, senha: 'qualquer-coisa' });
      expect(resposta.status).toBe(401);
    }

    const sexta = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'tentativa5@exemplo.com', senha: 'qualquer-coisa' });

    expect(sexta.status).toBe(429);
    expect(sexta.body.code).toBe('LIMITE_TENTATIVAS');
  });
});

function extrairCookieRefresh(response: request.Response): string {
  const cookies = (response.headers['set-cookie'] ?? []) as unknown as string[];
  const cookie = cookies.find((c) => c.startsWith(`${REFRESH_TOKEN_COOKIE_NAME}=`));
  if (!cookie) {
    throw new Error('Cookie de refresh não encontrado na resposta.');
  }
  return cookie.split(';')[0]!;
}
