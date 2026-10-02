import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaModule } from '../../database/prisma.module';
import { PrismaService } from '../../database/prisma.service';
import { HealthModule } from './health.module';

/**
 * PrismaService nunca é real aqui — só um objeto simples com os métodos que o HealthService usa
 * (RULES.md §5). PrismaModule é @Global(); incluí-lo no teste e sobrescrever o provider é como o
 * mock fica visível para o HealthModule sem precisar importar o PrismaModule nele.
 */
describe('GET /health (e2e)', () => {
  let app: INestApplication;
  const prismaMock = { isHealthy: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, HealthModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 com status ok quando o banco está acessível', async () => {
    prismaMock.isHealthy.mockResolvedValue(true);

    const response = await request(app.getHttpServer()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('responde 200 com status error quando o banco está inacessível', async () => {
    prismaMock.isHealthy.mockResolvedValue(false);

    const response = await request(app.getHttpServer()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'error', database: 'down' });
  });
});
