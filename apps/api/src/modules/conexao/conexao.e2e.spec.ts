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
import { PluggyGateway } from '../sync/pluggy.gateway';
import { ConexaoModule } from './conexao.module';

const SEGREDO_JWT = 'segredo-de-teste-para-access-token-32ch';
const A = 'user-a';
const B = 'user-b';
const ITEM_ID = 'item-sintetico-do-a';

const LINHA_DO_A = {
  id: 'c1',
  userId: A,
  itemId: ITEM_ID,
  statusItem: 'LOGIN_ERROR',
  statusExecucao: 'ERROR',
  consentimentoExpiraEm: new Date('2030-01-01T00:00:00.000Z'),
  ultimaAtualizacaoEm: new Date(),
  proximaAtualizacaoEm: null,
  autoSyncDesativadoEm: null,
  falhasDeLogin: 3,
  acaoPendente: false,
  verificadoEm: new Date(),
  erroVerificacao: null,
  atualizadoEm: new Date(),
};

describe('GET /conexao (e2e)', () => {
  let app: INestApplication;
  let tokenA: string;
  let tokenB: string;
  const gateway = { listarItem: jest.fn() };
  // O "banco" só devolve a linha para o dono: é isso que prova o isolamento.
  const prisma = {
    conexaoPluggy: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };

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
        ConexaoModule,
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

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    const jwt = moduleRef.get(JwtService, { strict: false });
    const assinar = async (sub: string) =>
      `Bearer ${await jwt.signAsync({ sub }, { secret: SEGREDO_JWT, expiresIn: 300 })}`;
    tokenA = await assinar(A);
    tokenB = await assinar(B);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.conexaoPluggy.findUnique.mockImplementation(
      async ({ where }: { where: { userId: string } }) => (where.userId === A ? LINHA_DO_A : null),
    );
  });

  const http = () => request(app.getHttpServer());

  it('CA-13: sem access token → 401 e nada é consultado', async () => {
    const r = await http().get('/conexao');

    expect(r.status).toBe(401);
    expect(prisma.conexaoPluggy.findUnique).not.toHaveBeenCalled();
  });

  it('CA-04: 200 com o contrato; item em LOGIN_ERROR vira CONEXAO_PRECISA_DE_VOCE e situação CRITICO', async () => {
    const r = await http().get('/conexao').set('Authorization', tokenA);

    expect(r.status).toBe(200);
    expect(r.body.situacao).toBe('CRITICO');
    expect(r.body.avisos[0]).toEqual({
      codigo: 'CONEXAO_PRECISA_DE_VOCE',
      severidade: 'CRITICO',
      acao: 'REAUTORIZAR_NO_MEU_PLUGGY',
      dias: null,
    });
    expect(r.body.conexao.status).toBe('LOGIN_ERROR');
    expect(typeof r.body.calculadoEm).toBe('string');
  });

  it('CA-13: a resposta nunca contém o itemId', async () => {
    const r = await http().get('/conexao').set('Authorization', tokenA);

    expect(JSON.stringify(r.body)).not.toContain(ITEM_ID);
    expect(r.body.conexao).not.toHaveProperty('itemId');
  });

  it('CA-14: o usuário B não vê o retrato do usuário A (conexao null, NUNCA_SINCRONIZADO)', async () => {
    const r = await http().get('/conexao').set('Authorization', tokenB);

    expect(r.status).toBe(200);
    expect(r.body.conexao).toBeNull();
    expect(r.body.avisos.map((a: { codigo: string }) => a.codigo)).toEqual(['NUNCA_SINCRONIZADO']);
    expect(prisma.conexaoPluggy.findUnique).toHaveBeenCalledWith({ where: { userId: B } });
  });

  it('o usuário vem da SESSÃO: um userId na query string não muda o dono da consulta', async () => {
    await http().get(`/conexao?userId=${A}`).set('Authorization', tokenB);

    expect(prisma.conexaoPluggy.findUnique).toHaveBeenCalledWith({ where: { userId: B } });
  });

  it('é só leitura: GET não chama o Pluggy e nenhum método de escrita existe na rota', async () => {
    await http().get('/conexao').set('Authorization', tokenA);
    expect(gateway.listarItem).not.toHaveBeenCalled();
    expect(prisma.conexaoPluggy.upsert).not.toHaveBeenCalled();

    for (const metodo of ['post', 'put', 'patch', 'delete'] as const) {
      const r = await http()[metodo]('/conexao').set('Authorization', tokenA).send({});
      expect(r.status).toBe(404);
    }
    expect(prisma.conexaoPluggy.upsert).not.toHaveBeenCalled();
  });
});
