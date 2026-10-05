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
import { RendaModule } from './renda.module';

const SEGREDO_JWT = 'segredo-de-teste-para-access-token-32ch';
const A = 'user-a';
const B = 'user-b';
const UUID_TX = '11111111-1111-4111-8111-111111111111';
const UUID_FONTE = '22222222-2222-4222-8222-222222222222';
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// Dados sintéticos (RULES §8). A chave é uma string qualquer: o teste prova que ela nunca sai.
const CHAVE = 'CHAVE-SECRETA-NAO-PODE-VAZAR';

const FONTE_DO_A = {
  id: UUID_FONTE,
  userId: A,
  tipo: 'SALARIO',
  origem: 'MANUAL',
  contraparteChave: CHAVE,
  nome: 'Empresa Teste',
  docMascarado: '**.345.678/****-**',
  vigenteDesde: d('2026-01-01'),
  vigenteAte: null,
  ativa: true,
  criadoEm: d('2026-01-01'),
  atualizadoEm: d('2026-01-01'),
};

const TX_DO_A = {
  id: UUID_TX,
  userId: A,
  tipo: 'CREDITO',
  data: d('2026-06-05'),
  valorCentavos: 100_000,
  contraparteChave: 'chave-nova',
  contraparteNome: 'Outra Empresa',
  contraparteDocMascarado: '**.111.222/****-**',
};

describe('salário e fontes de renda (e2e)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let tokenA: string;
  let tokenB: string;

  // O "banco" só devolve o que pertence ao usuário do `where`: é isso que prova o isolamento.
  const doUsuario = <T extends { userId: string }>(
    linhas: T[],
    where: { userId?: string; id?: string; contraparteChave?: string },
  ) =>
    linhas.filter((l) => {
      const linha = l as { id?: string; contraparteChave?: string };
      return (
        l.userId === where.userId &&
        (where.id === undefined || linha.id === where.id) &&
        (where.contraparteChave === undefined || linha.contraparteChave === where.contraparteChave)
      );
    });

  const prisma = {
    transacao: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      aggregate: jest.fn(),
    },
    fonteRenda: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
    },
    regraCategoria: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  function resetarMocks() {
    jest.resetAllMocks();
    prisma.transacao.findMany.mockResolvedValue([]);
    prisma.transacao.findFirst.mockImplementation(
      async ({ where }) => doUsuario([TX_DO_A], where)[0] ?? null,
    );
    prisma.transacao.aggregate.mockResolvedValue({ _min: { data: d('2026-02-03') } });
    prisma.fonteRenda.findMany.mockImplementation(async ({ where }) =>
      doUsuario([FONTE_DO_A], where),
    );
    prisma.fonteRenda.findFirst.mockImplementation(
      async ({ where }) => doUsuario([FONTE_DO_A], where)[0] ?? null,
    );
    prisma.fonteRenda.create.mockImplementation(async ({ data }) => ({
      ...FONTE_DO_A,
      id: 'nova',
      ...data,
    }));
    prisma.fonteRenda.update.mockImplementation(async ({ where, data }) => ({
      ...FONTE_DO_A,
      id: where.id,
      ...data,
    }));
    prisma.regraCategoria.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  }

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
        RendaModule,
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
    jwt = moduleRef.get(JwtService, { strict: false });
    const assinar = async (sub: string) =>
      `Bearer ${await jwt.signAsync({ sub }, { secret: SEGREDO_JWT, expiresIn: 300 })}`;
    tokenA = await assinar(A);
    tokenB = await assinar(B);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(resetarMocks);

  const http = () => request(app.getHttpServer());

  describe('autenticação', () => {
    it.each([
      ['get', '/salario'],
      ['post', '/salario/fonte'],
      ['patch', `/salario/fontes/${UUID_FONTE}/trocar`],
      ['get', '/renda/fontes'],
      ['patch', `/renda/fontes/${UUID_FONTE}`],
    ] as const)('CA-13: %s %s sem token → 401', async (metodo, rota) => {
      const r = await http()[metodo](rota).send({});

      expect(r.status).toBe(401);
      expect(prisma.fonteRenda.findMany).not.toHaveBeenCalled();
      expect(prisma.transacao.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('payload inválido → 400 sem tocar no banco', () => {
    it.each([
      ['corpo vazio', {}],
      ['transacaoId que não é UUID', { transacaoId: 'abc' }],
      ['campo extra', { transacaoId: UUID_TX, extra: 1 }],
      ['transacaoId numérico', { transacaoId: 123 }],
    ])('CA-11: POST /salario/fonte com %s', async (_nome, corpo) => {
      const r = await http().post('/salario/fonte').set('Authorization', tokenA).send(corpo);

      expect(r.status).toBe(400);
      expect(prisma.transacao.findFirst).not.toHaveBeenCalled();
    });

    it('CA-11: PATCH trocar com id da rota que não é UUID', async () => {
      const r = await http()
        .patch('/salario/fontes/nao-e-uuid/trocar')
        .set('Authorization', tokenA)
        .send({ transacaoId: UUID_TX });

      expect(r.status).toBe(400);
      expect(prisma.fonteRenda.findFirst).not.toHaveBeenCalled();
    });

    it.each([
      ['corpo vazio', {}],
      ['ativa como texto "sim"', { ativa: 'sim' }],
      ['ativa como texto "false" (nunca vira true)', { ativa: 'false' }],
      ['ativa como número', { ativa: 0 }],
      ['campo extra', { ativa: true, tipo: 'SALARIO' }],
    ])('CA-11: PATCH /renda/fontes/:id com %s', async (_nome, corpo) => {
      const r = await http()
        .patch(`/renda/fontes/${UUID_FONTE}`)
        .set('Authorization', tokenA)
        .send(corpo);

      expect(r.status).toBe(400);
      expect(prisma.fonteRenda.update).not.toHaveBeenCalled();
    });
  });

  describe('POST /salario/fonte', () => {
    it('CA-02: 201 com a FonteDto, sem a chave', async () => {
      const r = await http()
        .post('/salario/fonte')
        .set('Authorization', tokenA)
        .send({ transacaoId: UUID_TX });

      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({
        tipo: 'SALARIO',
        origem: 'MANUAL',
        nome: 'Outra Empresa',
        vigenteDesde: '2026-02-03',
        vigenteAte: null,
        ativa: true,
      });
      expect(JSON.stringify(r.body)).not.toContain('contraparteChave');
      expect(JSON.stringify(r.body)).not.toContain('chave-nova');
    });

    it('CA-11: saída → 422 NAO_E_ENTRADA', async () => {
      prisma.transacao.findFirst.mockResolvedValue({ ...TX_DO_A, tipo: 'DEBITO' });

      const r = await http()
        .post('/salario/fonte')
        .set('Authorization', tokenA)
        .send({ transacaoId: UUID_TX });

      expect(r.status).toBe(422);
      expect(r.body.code).toBe('NAO_E_ENTRADA');
    });

    it('CA-11: sem contraparte → 422 SEM_CONTRAPARTE', async () => {
      prisma.transacao.findFirst.mockResolvedValue({ ...TX_DO_A, contraparteChave: null });

      const r = await http()
        .post('/salario/fonte')
        .set('Authorization', tokenA)
        .send({ transacaoId: UUID_TX });

      expect(r.status).toBe(422);
      expect(r.body.code).toBe('SEM_CONTRAPARTE');
    });

    it('CA-03: origem que já é salário vigente → 409', async () => {
      prisma.transacao.findFirst.mockResolvedValue({ ...TX_DO_A, contraparteChave: CHAVE });

      const r = await http()
        .post('/salario/fonte')
        .set('Authorization', tokenA)
        .send({ transacaoId: UUID_TX });

      expect(r.status).toBe(409);
      expect(r.body.code).toBe('FONTE_JA_EXISTE');
    });
  });

  describe('PATCH /salario/fontes/:id/trocar', () => {
    it('CA-03: 200 com a encerrada e a nova; a chave não aparece', async () => {
      prisma.fonteRenda.findFirst.mockResolvedValueOnce(FONTE_DO_A).mockResolvedValueOnce(null);

      const r = await http()
        .patch(`/salario/fontes/${UUID_FONTE}/trocar`)
        .set('Authorization', tokenA)
        .send({ transacaoId: UUID_TX });

      expect(r.status).toBe(200);
      expect(r.body.encerrada).toMatchObject({ id: UUID_FONTE, vigenteAte: '2026-06-04' });
      expect(r.body.nova).toMatchObject({ vigenteDesde: '2026-06-05', vigenteAte: null });
      expect(JSON.stringify(r.body)).not.toContain(CHAVE);
    });

    it('fonte já encerrada → 422 FONTE_NAO_VIGENTE', async () => {
      prisma.fonteRenda.findFirst.mockResolvedValue({ ...FONTE_DO_A, vigenteAte: d('2026-03-31') });

      const r = await http()
        .patch(`/salario/fontes/${UUID_FONTE}/trocar`)
        .set('Authorization', tokenA)
        .send({ transacaoId: UUID_TX });

      expect(r.status).toBe(422);
      expect(r.body.code).toBe('FONTE_NAO_VIGENTE');
    });
  });

  describe('GET /salario e /renda/fontes', () => {
    it('CA-04: GET /salario devolve o contrato e nunca a chave', async () => {
      prisma.transacao.findMany.mockResolvedValue([
        { ...TX_DO_A, contraparteChave: CHAVE, valorCentavos: 150_000 },
      ]);

      const r = await http().get('/salario').set('Authorization', tokenA);

      expect(r.status).toBe(200);
      expect(r.body.fontesAtuais).toHaveLength(1);
      expect(r.body.valorAtualCentavos).toBe(150_000);
      expect(r.body.historico[0]).toMatchObject({ valorCentavos: 150_000, fonteId: UUID_FONTE });
      expect(JSON.stringify(r.body)).not.toContain(CHAVE);
    });

    it('CA-04: sem nada → listas vazias', async () => {
      prisma.fonteRenda.findMany.mockResolvedValue([]);

      const r = await http().get('/salario').set('Authorization', tokenA);

      expect(r.body).toEqual({
        fontesAtuais: [],
        valorAtualCentavos: null,
        historico: [],
        fontes: [],
      });
    });

    it('GET /renda/fontes lista as fontes sem a chave', async () => {
      const r = await http().get('/renda/fontes').set('Authorization', tokenA);

      expect(r.status).toBe(200);
      expect(r.body).toHaveLength(1);
      expect(JSON.stringify(r.body)).not.toContain(CHAVE);
    });
  });

  describe('PATCH /renda/fontes/:id', () => {
    it('CA-06: desativa a fonte', async () => {
      const r = await http()
        .patch(`/renda/fontes/${UUID_FONTE}`)
        .set('Authorization', tokenA)
        .send({ ativa: false });

      expect(r.status).toBe(200);
      expect(r.body.ativa).toBe(false);
    });
  });

  describe('CA-12: o usuário B nunca vê nem altera o que é do A', () => {
    it('GET /salario e /renda/fontes do B vêm vazios', async () => {
      const salario = await http().get('/salario').set('Authorization', tokenB);
      const fontes = await http().get('/renda/fontes').set('Authorization', tokenB);

      expect(salario.body).toEqual({
        fontesAtuais: [],
        valorAtualCentavos: null,
        historico: [],
        fontes: [],
      });
      expect(fontes.body).toEqual([]);
    });

    it('B apontando a transação do A → 404 (não revela que existe) e nada é criado', async () => {
      const r = await http()
        .post('/salario/fonte')
        .set('Authorization', tokenB)
        .send({ transacaoId: UUID_TX });

      expect(r.status).toBe(404);
      expect(r.body.code).toBe('TRANSACAO_NAO_ENCONTRADA');
      expect(prisma.fonteRenda.create).not.toHaveBeenCalled();
    });

    it('B trocando ou desativando a fonte do A → 404 e nada é alterado', async () => {
      const trocar = await http()
        .patch(`/salario/fontes/${UUID_FONTE}/trocar`)
        .set('Authorization', tokenB)
        .send({ transacaoId: UUID_TX });
      const ativar = await http()
        .patch(`/renda/fontes/${UUID_FONTE}`)
        .set('Authorization', tokenB)
        .send({ ativa: false });

      expect(trocar.status).toBe(404);
      expect(ativar.status).toBe(404);
      expect(prisma.fonteRenda.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('toda consulta usa o usuário da SESSÃO, nunca um id vindo do cliente', async () => {
      await http().get('/salario?userId=user-a').set('Authorization', tokenB);

      for (const chamada of prisma.fonteRenda.findMany.mock.calls) {
        expect(chamada[0].where.userId).toBe(B);
      }
    });
  });
});
