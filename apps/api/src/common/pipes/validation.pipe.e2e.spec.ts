import { Body, Controller, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsString } from 'class-validator';
import request from 'supertest';
import { createValidationPipe } from './validation.pipe';

// DTO e controller só existem neste arquivo, para provar o comportamento do ValidationPipe
// global sem precisar de uma rota de negócio real (nenhuma existe ainda — RULES.md).
class DummyDto {
  @IsString()
  nome!: string;
}

@Controller('dummy')
class DummyController {
  @Post()
  handle(@Body() body: DummyDto): DummyDto {
    return body;
  }
}

describe('createValidationPipe (e2e)', () => {
  let app: import('@nestjs/common').INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DummyController],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('aceita um body que bate com o DTO', async () => {
    const response = await request(app.getHttpServer()).post('/dummy').send({ nome: 'ok' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ nome: 'ok' });
  });

  it('rejeita um campo não declarado no DTO (whitelist + forbidNonWhitelisted)', async () => {
    const response = await request(app.getHttpServer())
      .post('/dummy')
      .send({ nome: 'ok', campoNaoDeclarado: 'nunca deveria passar' });

    expect(response.status).toBe(400);
  });
});
