import { Controller, Get, type INestApplication, Req } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { type Request } from 'express';
import request from 'supertest';
import { setupApp } from './app.setup';
import { Public } from './common/decorators/public.decorator';

@Public()
@Controller('ip')
class IpController {
  @Get()
  ip(@Req() req: Request): { ip: string | undefined } {
    return { ip: req.ip };
  }
}

async function subir(hops?: number): Promise<INestApplication> {
  const env: Record<string, unknown> = { WEB_ORIGIN: 'http://localhost:5173' };
  if (hops !== undefined) {
    env.TRUST_PROXY_HOPS = hops;
  }
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => env] })],
    controllers: [IpController],
  }).compile();
  const app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();
  return app;
}

describe('trust proxy (limite por IP atrás de proxy)', () => {
  it('sem TRUST_PROXY_HOPS ignora o X-Forwarded-For: forjar o cabeçalho não muda o IP', async () => {
    const app = await subir();
    const r = await request(app.getHttpServer()).get('/ip').set('X-Forwarded-For', '6.6.6.6');

    expect(r.body.ip).not.toBe('6.6.6.6');
    await app.close();
  });

  it('com 1 salto o IP é o último endereço do cabeçalho (o que o proxy confiável anexou)', async () => {
    const app = await subir(1);
    const r = await request(app.getHttpServer()).get('/ip').set('X-Forwarded-For', '203.0.113.9');

    expect(r.body.ip).toBe('203.0.113.9');
    await app.close();
  });

  it('com 1 salto, endereços forjados à esquerda são ignorados', async () => {
    const app = await subir(1);
    const r = await request(app.getHttpServer())
      .get('/ip')
      .set('X-Forwarded-For', '6.6.6.6, 203.0.113.9');

    expect(r.body.ip).toBe('203.0.113.9');
    await app.close();
  });
});
