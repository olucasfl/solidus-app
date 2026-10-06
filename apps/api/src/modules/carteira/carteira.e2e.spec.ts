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
import { CdiIndisponivelError } from './carteira-errors';
import { CarteiraModule } from './carteira.module';
import { CdiGateway } from './cdi.gateway';

const SEGREDO_JWT = 'segredo-de-teste-para-access-token-32ch';
const TOKEN_SYNC = 'e'.repeat(64);
const UUID = '3f2b8c1e-5a7d-4e0f-9b6a-1c2d3e4f5a6b';

describe('carteira por Caixinha (e2e)', () => {
  let app: INestApplication;
  let auth: string;
  const gateway = { buscar: jest.fn() };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ papel: 'ADMIN' }) },
    caixinha: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    movimentoCaixinha: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      deleteMany: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _min: { data: null } }),
    },
    transacao: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    cdiDia: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      aggregate: jest.fn().mockResolvedValue({ _min: { data: null }, _max: { data: null } }),
    },
    faixaImposto: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockReturnValue('delete'),
      createMany: jest.fn().mockReturnValue('create'),
    },
    $transaction: jest.fn().mockResolvedValue([]),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              NODE_ENV: 'test',
              JWT_ACCESS_SECRET: SEGREDO_JWT,
              SYNC_CRON_TOKEN: TOKEN_SYNC,
            }),
          ],
        }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
        JwtModule.register({}),
        PrismaModule,
        CarteiraModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_GUARD, useClass: ApiThrottlerGuard },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(CdiGateway)
      .useValue(gateway)
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

  beforeEach(() => {
    prisma.caixinha.create.mockReset();
    prisma.caixinha.update.mockReset();
    prisma.caixinha.findFirst.mockReset().mockResolvedValue({ id: UUID });
    prisma.movimentoCaixinha.create.mockReset();
    prisma.$transaction.mockClear();
    gateway.buscar.mockReset().mockResolvedValue([]);
  });

  const http = () => request(app.getHttpServer());

  it('CA-21: todas as rotas de usuário exigem access token', async () => {
    const chamadas = [
      () => http().get('/caixinhas'),
      () => http().post('/caixinhas').send({ nome: 'x', percentualCdiBp: 0 }),
      () => http().patch(`/caixinhas/${UUID}`).send({ ativa: false }),
      () => http().delete(`/caixinhas/${UUID}`),
      () => http().get(`/caixinhas/${UUID}/conferencia`),
      () => http().get(`/caixinhas/${UUID}/movimentos`),
      () =>
        http()
          .post(`/caixinhas/${UUID}/movimentos`)
          .send({ tipo: 'SALDO', data: '2026-01-01', valorCentavos: 0 }),
      () => http().delete(`/movimentos/${UUID}`),
      () => http().get('/movimentos/sugestoes?desde=2026-01-01'),
      () => http().get('/impostos'),
      () => http().put('/impostos/IR').send({ faixas: [] }),
      () => http().get('/carteira'),
    ];
    for (const chamada of chamadas) {
      expect((await chamada()).status).toBe(401);
    }
  });

  describe('POST /caixinhas', () => {
    it.each([
      ['nome vazio', { nome: '', percentualCdiBp: 10_000 }],
      ['nome só com espaços', { nome: '   ', percentualCdiBp: 10_000 }],
      ['nome com 61 caracteres', { nome: 'a'.repeat(61), percentualCdiBp: 10_000 }],
      ['percentual negativo', { nome: 'x', percentualCdiBp: -1 }],
      ['percentual acima do teto', { nome: 'x', percentualCdiBp: 100_001 }],
      ['percentual fracionário', { nome: 'x', percentualCdiBp: 11.5 }],
      ['percentual ausente', { nome: 'x' }],
      ['reservaDeGastos não booleano', { nome: 'x', percentualCdiBp: 0, reservaDeGastos: 'sim' }],
      [
        'reservaDeGastos como texto "false"',
        { nome: 'x', percentualCdiBp: 0, reservaDeGastos: 'false' },
      ],
      ['campo extra', { nome: 'x', percentualCdiBp: 0, admin: true }],
    ])('CA-13: %s → 400 e nada é gravado', async (_nome, corpo) => {
      const r = await http().post('/caixinhas').set('Authorization', auth).send(corpo);

      expect(r.status).toBe(400);
      expect(prisma.caixinha.create).not.toHaveBeenCalled();
    });

    it('CA-13: válida → 201 (nome com trim)', async () => {
      prisma.caixinha.create.mockResolvedValue({
        id: UUID,
        nome: 'Turbo',
        percentualCdiBp: 11_500,
        reservaDeGastos: false,
        ativa: true,
      });

      const r = await http()
        .post('/caixinhas')
        .set('Authorization', auth)
        .send({ nome: '  Turbo  ', percentualCdiBp: 11_500 });

      expect(r.status).toBe(201);
      expect(prisma.caixinha.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          nome: 'Turbo',
          percentualCdiBp: 11_500,
          reservaDeGastos: false,
          reservaEmergencia: false,
          convencaoRendimento: null,
        },
      });
    });
  });

  describe('reserva de emergência (spec reserva-emergencia)', () => {
    it.each([
      ['texto "false" (nunca vira true por conversão implícita)', { reservaEmergencia: 'false' }],
      ['texto "true"', { reservaEmergencia: 'true' }],
      ['número 1', { reservaEmergencia: 1 }],
      ['null', { reservaEmergencia: null }],
    ])('CA-13: POST /caixinhas com reservaEmergencia %s → 400, sem criar', async (_nome, extra) => {
      const r = await http()
        .post('/caixinhas')
        .set('Authorization', auth)
        .send({ nome: 'Turbo', percentualCdiBp: 11_500, ...extra });

      expect(r.status).toBe(400);
      expect(prisma.caixinha.create).not.toHaveBeenCalled();
    });

    it('CA-13: POST /caixinhas com reservaEmergencia true → 201 e grava true', async () => {
      prisma.caixinha.create.mockResolvedValue({
        id: UUID,
        nome: 'Turbo',
        percentualCdiBp: 11_500,
        reservaDeGastos: false,
        reservaEmergencia: true,
        ativa: true,
      });

      const r = await http()
        .post('/caixinhas')
        .set('Authorization', auth)
        .send({ nome: 'Turbo', percentualCdiBp: 11_500, reservaEmergencia: true });

      expect(r.status).toBe(201);
      expect(r.body.reservaEmergencia).toBe(true);
      expect(prisma.caixinha.create.mock.calls[0]![0].data.reservaEmergencia).toBe(true);
    });

    it('CA-14: POST com as duas reservas → 400 CAIXINHA_RESERVAS_INCOMPATIVEIS', async () => {
      const r = await http()
        .post('/caixinhas')
        .set('Authorization', auth)
        .send({ nome: 'X', percentualCdiBp: 0, reservaDeGastos: true, reservaEmergencia: true });

      expect(r.status).toBe(400);
      expect(r.body.code).toBe('CAIXINHA_RESERVAS_INCOMPATIVEIS');
      expect(prisma.caixinha.create).not.toHaveBeenCalled();
    });

    it('CA-13: PATCH com reservaEmergencia em texto ("false") → 400, sem tocar no banco', async () => {
      const r = await http()
        .patch(`/caixinhas/${UUID}`)
        .set('Authorization', auth)
        .send({ reservaEmergencia: 'false' });

      expect(r.status).toBe(400);
      expect(prisma.caixinha.update).not.toHaveBeenCalled();
    });

    it('CA-13: PATCH com reservaEmergencia null → 400 (null não vai para uma coluna booleana obrigatória)', async () => {
      const r = await http()
        .patch(`/caixinhas/${UUID}`)
        .set('Authorization', auth)
        .send({ reservaEmergencia: null });

      expect(r.status).toBe(400);
      expect(prisma.caixinha.update).not.toHaveBeenCalled();
    });

    it('CA-14: PATCH que deixaria a Caixinha com as duas reservas → 400 e nada muda', async () => {
      prisma.caixinha.findFirst.mockResolvedValue({
        id: UUID,
        reservaDeGastos: true,
        reservaEmergencia: false,
      });

      const r = await http()
        .patch(`/caixinhas/${UUID}`)
        .set('Authorization', auth)
        .send({ reservaEmergencia: true });

      expect(r.status).toBe(400);
      expect(r.body.code).toBe('CAIXINHA_RESERVAS_INCOMPATIVEIS');
      expect(prisma.caixinha.update).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /caixinhas/:id: null em campo OBRIGATÓRIO é 400, não 500', () => {
    // `@IsOptional()` trata null como "ausente"; o service só olha `!== undefined`, e o null chegava ao
    // Prisma, que o recusa numa coluna obrigatória (500). Em `convencaoRendimento` o null é PROPOSITAL.
    it.each([
      ['nome', { nome: null }],
      ['percentualCdiBp', { percentualCdiBp: null }],
      ['reservaDeGastos', { reservaDeGastos: null }],
      ['ativa', { ativa: null }],
    ])('%s: null → 400 e nada é gravado', async (_campo, corpo) => {
      prisma.caixinha.update.mockClear();

      const r = await http().patch(`/caixinhas/${UUID}`).set('Authorization', auth).send(corpo);

      expect(r.status).toBe(400);
      expect(prisma.caixinha.update).not.toHaveBeenCalled();
    });

    it('controle: convencaoRendimento null continua válido (volta ao padrão)', async () => {
      prisma.caixinha.findFirst.mockResolvedValue({
        id: UUID,
        reservaDeGastos: false,
        reservaEmergencia: false,
      });
      prisma.caixinha.update.mockResolvedValue({
        id: UUID,
        nome: 'Turbo',
        percentualCdiBp: 11_500,
        reservaDeGastos: false,
        reservaEmergencia: false,
        convencaoRendimento: null,
        ativa: true,
      });

      const r = await http()
        .patch(`/caixinhas/${UUID}`)
        .set('Authorization', auth)
        .send({ convencaoRendimento: null });

      expect(r.status).toBe(200);
    });
  });

  it('CA-13: PATCH com `ativa` em texto ("false") é 400 — nunca vira true por conversão implícita', async () => {
    const r = await http()
      .patch(`/caixinhas/${UUID}`)
      .set('Authorization', auth)
      .send({ ativa: 'false' });

    expect(r.status).toBe(400);
    expect(prisma.caixinha.update).not.toHaveBeenCalled();
  });

  it('CA-13: PATCH/DELETE — id não-UUID 400; inexistente 404 CAIXINHA_NAO_ENCONTRADA', async () => {
    expect(
      (await http().patch('/caixinhas/x').set('Authorization', auth).send({ ativa: false })).status,
    ).toBe(400);
    expect((await http().delete('/caixinhas/x').set('Authorization', auth)).status).toBe(400);

    prisma.caixinha.findFirst.mockResolvedValue(null);
    const patch = await http()
      .patch(`/caixinhas/${UUID}`)
      .set('Authorization', auth)
      .send({ ativa: false });
    expect(patch.status).toBe(404);
    expect(patch.body.code).toBe('CAIXINHA_NAO_ENCONTRADA');

    prisma.caixinha.deleteMany.mockResolvedValue({ count: 0 });
    expect((await http().delete(`/caixinhas/${UUID}`).set('Authorization', auth)).status).toBe(404);
    prisma.caixinha.deleteMany.mockResolvedValue({ count: 1 });
    expect((await http().delete(`/caixinhas/${UUID}`).set('Authorization', auth)).status).toBe(204);
  });

  describe('convenção de rendimento e conferência', () => {
    it('PATCH aceita as duas convenções e null; texto desconhecido é 400', async () => {
      prisma.caixinha.update.mockResolvedValue({
        id: UUID,
        nome: 'Turbo',
        percentualCdiBp: 11_500,
        reservaDeGastos: false,
        convencaoRendimento: null,
        ativa: true,
      });
      const patch = (corpo: object) =>
        http().patch(`/caixinhas/${UUID}`).set('Authorization', auth).send(corpo);

      expect((await patch({ convencaoRendimento: 'MOVIMENTO_DEPOIS_DO_RENDIMENTO' })).status).toBe(
        200,
      );
      expect((await patch({ convencaoRendimento: null })).status).toBe(200);
      expect((await patch({ convencaoRendimento: 'OUTRA' })).status).toBe(400);
    });

    it('GET /caixinhas/:id/conferencia: 400 com id inválido, 404 inexistente, 200 sem saldos suficientes', async () => {
      expect((await http().get('/caixinhas/x/conferencia').set('Authorization', auth)).status).toBe(
        400,
      );

      prisma.caixinha.findFirst.mockResolvedValueOnce(null);
      const nao = await http().get(`/caixinhas/${UUID}/conferencia`).set('Authorization', auth);
      expect(nao.status).toBe(404);
      expect(nao.body.code).toBe('CAIXINHA_NAO_ENCONTRADA');

      prisma.caixinha.findFirst.mockResolvedValueOnce({
        id: UUID,
        percentualCdiBp: 10_000,
        convencaoRendimento: null,
        movimentos: [],
      });
      const ok = await http().get(`/caixinhas/${UUID}/conferencia`).set('Authorization', auth);
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({
        caixinhaId: UUID,
        convencaoEmUso: 'MOVIMENTO_ANTES_DO_RENDIMENTO',
        convencaoSugerida: null,
      });
      expect(ok.body.porConvencao).toHaveLength(2);
    });
  });

  describe('POST /caixinhas/:id/movimentos', () => {
    const ok = { tipo: 'SALDO', data: '2026-01-01', valorCentavos: 100 };
    const post = (corpo: object) =>
      http().post(`/caixinhas/${UUID}/movimentos`).set('Authorization', auth).send(corpo);

    it.each([
      ['tipo inválido', { ...ok, tipo: 'DEPOSITO' }],
      ['data fora do formato', { ...ok, data: '01/01/2026' }],
      ['valor negativo', { ...ok, valorCentavos: -1 }],
      ['valor fracionário', { ...ok, valorCentavos: 1.5 }],
      ['transacaoId não-UUID', { tipo: 'APORTE', data: '2026-01-01', transacaoId: 'abc' }],
      ['dataOrigem fora do formato', { ...ok, dataOrigem: 'ontem' }],
      ['campo extra', { ...ok, saldo: 1 }],
    ])('CA-14: %s → 400 sem gravar', async (_nome, corpo) => {
      const r = await post(corpo);

      expect(r.status).toBe(400);
      expect(prisma.movimentoCaixinha.create).not.toHaveBeenCalled();
    });

    it('CA-14: data futura → 400 DATA_FUTURA; APORTE com valor 0 → 400', async () => {
      const futura = await post({ ...ok, data: '2999-01-01' });
      expect(futura.status).toBe(400);
      expect(futura.body.code).toBe('DATA_FUTURA');

      const zero = await post({ tipo: 'APORTE', data: '2026-01-01', valorCentavos: 0 });
      expect(zero.status).toBe(400);
      expect(zero.body.code).toBe('VALOR_INVALIDO');
    });

    it('CA-14: SALDO válido → 201', async () => {
      prisma.movimentoCaixinha.create.mockResolvedValue({
        id: UUID,
        caixinhaId: UUID,
        tipo: 'SALDO',
        data: new Date('2026-01-01T00:00:00Z'),
        valorCentavos: 100,
        dataOrigem: null,
        transacaoId: null,
      });

      const r = await post(ok);

      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ tipo: 'SALDO', data: '2026-01-01', valorCentavos: 100 });
    });

    it('CA-15: transação já vinculada → 409; de outra categoria → 422', async () => {
      prisma.transacao.findFirst.mockResolvedValueOnce({
        id: UUID,
        categoria: 'INVESTIMENTO',
        tipo: 'DEBITO',
        valorCentavos: -100,
        movimentoCaixinha: { id: 'm1' },
      });
      const vinculada = await post({ tipo: 'APORTE', data: '2026-01-01', transacaoId: UUID });
      expect(vinculada.status).toBe(409);
      expect(vinculada.body.code).toBe('TRANSACAO_JA_VINCULADA');

      prisma.transacao.findFirst.mockResolvedValueOnce({ id: UUID, categoria: 'MERCADO' });
      const outra = await post({ tipo: 'APORTE', data: '2026-01-01', transacaoId: UUID });
      expect(outra.status).toBe(422);
      expect(outra.body.code).toBe('TRANSACAO_INVALIDA');
    });
  });

  it('CA-16: sugestões — sem `desde` ou malformado → 400; válido → 200', async () => {
    for (const q of ['', '?desde=', '?desde=2026-13-01', '?desde=01/01/2026']) {
      const r = await http().get(`/movimentos/sugestoes${q}`).set('Authorization', auth);
      expect([400]).toContain(r.status);
    }
    const ok = await http()
      .get('/movimentos/sugestoes?desde=2026-01-01')
      .set('Authorization', auth);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual([]);
  });

  it('CA-11: movimento inexistente → 404 MOVIMENTO_NAO_ENCONTRADO; id inválido → 400', async () => {
    prisma.movimentoCaixinha.deleteMany.mockResolvedValue({ count: 0 });

    const nao = await http().delete(`/movimentos/${UUID}`).set('Authorization', auth);
    expect(nao.status).toBe(404);
    expect(nao.body.code).toBe('MOVIMENTO_NAO_ENCONTRADO');
    expect((await http().delete('/movimentos/x').set('Authorization', auth)).status).toBe(400);
  });

  describe('/impostos (CA-17)', () => {
    it('quem não é ADMIN não edita as tabelas: 403 ACESSO_NEGADO e nada é gravado', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ papel: null });
      prisma.$transaction.mockClear();

      const r = await http()
        .put('/impostos/IR')
        .set('Authorization', auth)
        .send({ faixas: [{ ateDias: null, aliquotaBp: 1_500 }] });

      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ code: 'ACESSO_NEGADO' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    const put = (tipo: string, corpo: object) =>
      http().put(`/impostos/${tipo}`).set('Authorization', auth).send(corpo);

    it('tipo desconhecido → 400', async () => {
      expect((await put('ISS', { faixas: [] })).status).toBe(400);
    });

    it.each([
      ['faixas ausente', {}],
      ['faixas não é lista', { faixas: 'x' }],
      ['ateDias não inteiro', { faixas: [{ ateDias: 1.5, aliquotaBp: 1 }] }],
      ['aliquota ausente', { faixas: [{ ateDias: 10 }] }],
      ['campo extra na faixa', { faixas: [{ ateDias: 10, aliquotaBp: 1, x: 1 }] }],
    ])('corpo mal formado (%s) → 400 sem tocar o banco', async (_nome, corpo) => {
      const r = await put('IR', corpo);

      expect(r.status).toBe(400);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('faixas fora de ordem → 400 FAIXAS_INVALIDAS com os problemas; tabela anterior permanece', async () => {
      const r = await put('IR', {
        faixas: [
          { ateDias: 360, aliquotaBp: 2_000 },
          { ateDias: 180, aliquotaBp: 2_250 },
        ],
      });

      expect(r.status).toBe(400);
      expect(r.body.code).toBe('FAIXAS_INVALIDAS');
      expect(r.body.problemas.length).toBeGreaterThan(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('tabela válida (com a última faixa sem limite) → 200', async () => {
      const r = await put('IR', {
        faixas: [
          { ateDias: 180, aliquotaBp: 2_250 },
          { ateDias: null, aliquotaBp: 1_500 },
        ],
      });

      expect(r.status).toBe(200);
      expect(r.body).toEqual([
        { ateDias: 180, aliquotaBp: 2_250 },
        { ateDias: null, aliquotaBp: 1_500 },
      ]);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('GET /impostos devolve as duas tabelas', async () => {
      const r = await http().get('/impostos').set('Authorization', auth);

      expect(r.status).toBe(200);
      expect(r.body).toEqual({ IR: [], IOF: [] });
    });
  });

  describe('GET /carteira', () => {
    it.each([['?data=ontem'], ['?data=2026-13-01'], ['?data=2026-1-1']])(
      'data malformada %s → 400',
      async (q) => {
        expect((await http().get(`/carteira${q}`).set('Authorization', auth)).status).toBe(400);
      },
    );

    it('data futura → 400 DATA_FUTURA; sem data → 200', async () => {
      const futura = await http().get('/carteira?data=2999-01-01').set('Authorization', auth);
      expect(futura.status).toBe(400);
      expect(futura.body.code).toBe('DATA_FUTURA');

      const ok = await http().get('/carteira').set('Authorization', auth);
      expect(ok.status).toBe(200);
      expect(ok.body.caixinhas).toEqual([]);
    });
  });

  describe('POST /cdi/sincronizar (CA-18)', () => {
    it('sem token e com token errado → 401 SYNC_TOKEN_INVALIDO, sem chamar o BCB', async () => {
      const sem = await http().post('/cdi/sincronizar');
      const errado = await http().post('/cdi/sincronizar').set('x-sync-token', 'f'.repeat(64));

      expect(sem.status).toBe(401);
      expect(errado.status).toBe(401);
      expect(sem.body.code).toBe('SYNC_TOKEN_INVALIDO');
      expect(gateway.buscar).not.toHaveBeenCalled();
    });

    it('o access token de usuário NÃO substitui o token do cron', async () => {
      const r = await http().post('/cdi/sincronizar').set('Authorization', auth);

      expect(r.status).toBe(401);
    });

    it('token certo → 200 com os contadores', async () => {
      gateway.buscar.mockResolvedValue([{ data: '2026-10-02', taxaE8: 55_131 }]);

      const r = await http().post('/cdi/sincronizar').set('x-sync-token', TOKEN_SYNC);

      expect(r.status).toBe(200);
      expect(r.body).toEqual({ dias: 1, novos: 1 });
    });

    it('BCB fora do ar → 502 CDI_INDISPONIVEL genérico', async () => {
      gateway.buscar.mockRejectedValue(new CdiIndisponivelError());

      const r = await http().post('/cdi/sincronizar').set('x-sync-token', TOKEN_SYNC);

      expect(r.status).toBe(502);
      expect(r.body.code).toBe('CDI_INDISPONIVEL');
    });
  });
});
