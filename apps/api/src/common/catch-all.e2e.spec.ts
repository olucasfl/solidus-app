import { type INestApplication, Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { AccessGuard } from './guards/access.guard';
import { CatchAllModule } from './catch-all.module';

const SEGREDO_JWT = 'segredo-de-teste-para-access-token-32ch';

// Uma rota REAL só com GET, para provar o comportamento de "método errado numa rota que existe".
@Controller('real')
class RealController {
  @Get()
  ok() {
    return { ok: true };
  }
}

@Module({ controllers: [RealController] })
class RealModule {}

describe('CatchAllController (e2e): rota que nenhum controller casou', () => {
  let app: INestApplication;
  let auth: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ NODE_ENV: 'test', JWT_ACCESS_SECRET: SEGREDO_JWT })],
        }),
        JwtModule.register({}),
        // Mesma ordem do app.module.ts: o CatchAll por ÚLTIMO.
        RealModule,
        CatchAllModule,
      ],
      providers: [{ provide: APP_GUARD, useClass: AccessGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    auth = `Bearer ${await moduleRef
      .get(JwtService, { strict: false })
      .signAsync({ sub: 'user-1' }, { secret: SEGREDO_JWT, expiresIn: 300 })}`;
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  describe('sem login: continua 401 (não revela se a rota existe)', () => {
    it('rota inexistente → 401', async () => {
      expect((await http().get('/nao-existe')).status).toBe(401);
    });

    it('método errado numa rota que existe → 401 (igual a uma inexistente)', async () => {
      expect((await http().delete('/real')).status).toBe(401);
    });
  });

  describe('com login válido: 404 de verdade', () => {
    it.each([
      ['get', '/nao-existe'],
      ['post', '/nao-existe'],
      ['put', '/nao-existe'],
      ['patch', '/nao-existe'],
      ['delete', '/nao-existe'],
      ['get', '/real/sub/rota/funda'],
    ] as const)('%s %s → 404 (não 200 vazio)', async (metodo, rota) => {
      const r = await http()[metodo](rota).set('Authorization', auth).send({});

      expect(r.status).toBe(404);
      expect(r.body).toMatchObject({ statusCode: 404, code: 'ROTA_NAO_ENCONTRADA' });
    });

    it('método errado numa rota que existe (DELETE /real, só tem GET) → 404', async () => {
      const r = await http().delete('/real').set('Authorization', auth);

      expect(r.status).toBe(404);
    });

    it('a rota real continua respondendo normalmente (o catch-all não a engole)', async () => {
      const r = await http().get('/real').set('Authorization', auth);

      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true });
    });

    it('o corpo do 404 não revela nada além de "rota não encontrada"', async () => {
      const r = await http().get('/qualquer-coisa-123').set('Authorization', auth);

      expect(Object.keys(r.body).sort()).toEqual(['code', 'message', 'statusCode']);
    });
  });
});
