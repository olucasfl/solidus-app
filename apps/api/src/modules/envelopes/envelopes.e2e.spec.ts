import { type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { AccessGuard } from '../../common/guards/access.guard';
import { ApiThrottlerGuard } from '../../common/guards/api-throttler.guard';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { PrismaModule } from '../../database/prisma.module';
import { PrismaService } from '../../database/prisma.service';
import { CarteiraService } from '../carteira/carteira.service';
import { ReservaService } from '../reserva/reserva.service';
import { EnvelopesModule } from './envelopes.module';

const SEGREDO_JWT = 'segredo-de-teste-para-access-token-32ch';
const A = 'user-a';
const B = 'user-b';
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_INEXISTENTE = '99999999-9999-4999-8999-999999999999';

interface Linha {
  id: string;
  userId: string;
  nome: string;
  alocadoCentavos: number;
  metaCentavos: number | null;
  criadoEm: Date;
}

describe('envelopes (e2e)', () => {
  let app: INestApplication;
  let tokenA: string;
  let tokenB: string;
  let tabela: Linha[];

  // "Banco" em memória que respeita o filtro por userId e o @@unique([userId, nome]): é o que prova isolamento.
  const prisma = {
    conta: { findMany: jest.fn() },
    envelope: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const carteira = { consultar: jest.fn() };
  const reserva = { obter: jest.fn() };

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
        EnvelopesModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_GUARD, useClass: ApiThrottlerGuard },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(CarteiraService)
      .useValue(carteira)
      .overrideProvider(ReservaService)
      .useValue(reserva)
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
    let seq = 0;
    tabela = [
      {
        id: ID_A,
        userId: A,
        nome: 'Viagem',
        alocadoCentavos: 30_000,
        metaCentavos: 100_000,
        criadoEm: new Date('2026-10-01T00:00:00Z'),
      },
    ];
    const duplicado = (userId: string, nome: string, ignorar?: string) =>
      tabela.some((l) => l.userId === userId && l.nome === nome && l.id !== ignorar);
    const p2002 = () =>
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'teste',
      });

    prisma.conta.findMany.mockResolvedValue([{ tipo: 'CORRENTE', saldoCentavos: 4_545 }]);
    prisma.envelope.findMany.mockImplementation(async ({ where }: { where: { userId: string } }) =>
      tabela.filter((l) => l.userId === where.userId),
    );
    prisma.envelope.findFirst.mockImplementation(
      async ({ where }: { where: { id: string; userId: string } }) =>
        tabela.find((l) => l.id === where.id && l.userId === where.userId) ?? null,
    );
    prisma.envelope.create.mockImplementation(
      async ({ data }: { data: Omit<Linha, 'id' | 'criadoEm'> }) => {
        if (duplicado(data.userId, data.nome)) throw p2002();
        const nova: Linha = {
          ...data,
          id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
          criadoEm: new Date(),
        };
        tabela.push(nova);
        return nova;
      },
    );
    prisma.envelope.update.mockImplementation(
      async ({ where, data }: { where: { id: string; userId: string }; data: Partial<Linha> }) => {
        const l = tabela.find((x) => x.id === where.id && x.userId === where.userId)!;
        if (data.nome !== undefined && duplicado(l.userId, data.nome, l.id)) throw p2002();
        Object.assign(l, data);
        return l;
      },
    );
    prisma.envelope.deleteMany.mockImplementation(
      async ({ where }: { where: { id: string; userId: string } }) => {
        const antes = tabela.length;
        tabela = tabela.filter((l) => !(l.id === where.id && l.userId === where.userId));
        return { count: antes - tabela.length };
      },
    );
    carteira.consultar.mockResolvedValue({
      data: '2026-10-07',
      caixinhas: [
        {
          id: 'cx-1',
          nome: 'Turbo',
          ativa: true,
          reservaEmergencia: false,
          saldoBrutoEstimadoCentavos: 110_000,
          saldoLiquidoEstimadoCentavos: 100_000,
          avisos: [],
        },
      ],
      totais: { patrimonioCentavos: 0, investidoCentavos: 0, disponivelParaGastarCentavos: 0 },
      avisos: [],
    });
    reserva.obter.mockResolvedValue({ metaCentavos: 0 });
  });

  const http = () => request(app.getHttpServer());

  it.each([
    ['get', '/envelopes'],
    ['post', '/envelopes'],
    ['patch', `/envelopes/${ID_A}`],
    ['delete', `/envelopes/${ID_A}`],
  ] as const)('CA-16: %s %s sem access token → 401 e nada é tocado', async (metodo, rota) => {
    const r = await http()[metodo](rota).send({ nome: 'X' });

    expect(r.status).toBe(401);
    expect(prisma.envelope.findMany).not.toHaveBeenCalled();
    expect(prisma.envelope.create).not.toHaveBeenCalled();
    expect(prisma.envelope.update).not.toHaveBeenCalled();
    expect(prisma.envelope.deleteMany).not.toHaveBeenCalled();
  });

  describe('GET /envelopes', () => {
    it('CA-01: 200 com o contrato e os números do A', async () => {
      const r = await http().get('/envelopes').set('Authorization', tokenA);

      expect(r.status).toBe(200);
      expect(Object.keys(r.body).sort()).toEqual(
        [
          'avisos',
          'data',
          'disponivel',
          'envelopes',
          'livreCentavos',
          'reserva',
          'totalAlocadoCentavos',
        ].sort(),
      );
      expect(r.body.disponivel.totalCentavos).toBe(104_545);
      expect(r.body.totalAlocadoCentavos).toBe(30_000);
      expect(r.body.livreCentavos).toBe(74_545);
      expect(r.body.envelopes).toHaveLength(1);
      expect(r.body.envelopes[0]).toMatchObject({ id: ID_A, progressoBp: 3_000 });
    });

    it('CA-15: B não vê o envelope do A, e o dono vem da SESSÃO (não de ?userId)', async () => {
      const r = await http().get(`/envelopes?userId=${A}`).set('Authorization', tokenB);

      expect(r.status).toBe(200);
      expect(r.body.envelopes).toEqual([]);
      expect(r.body.totalAlocadoCentavos).toBe(0);
      expect(carteira.consultar).toHaveBeenCalledWith(B);
    });
  });

  describe('POST /envelopes', () => {
    it('CA-09: 201 com padrões (alocado 0, sem meta) e aparece no GET', async () => {
      const r = await http()
        .post('/envelopes')
        .set('Authorization', tokenB)
        .send({ nome: '  Setup  ' });

      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({
        nome: 'Setup',
        alocadoCentavos: 0,
        metaCentavos: null,
        progressoBp: null,
        atingida: false,
      });
      expect(tabela.find((l) => l.nome === 'Setup')!.userId).toBe(B);
      const lista = await http().get('/envelopes').set('Authorization', tokenB);
      expect(lista.body.envelopes).toHaveLength(1);
    });

    it('CA-10: alocar mais do que existe NÃO é bloqueado: 201, e o GET avisa', async () => {
      const r = await http()
        .post('/envelopes')
        .set('Authorization', tokenB)
        .send({ nome: 'Sonho', alocadoCentavos: 2_000_000_000 });

      expect(r.status).toBe(201);
      const lista = await http().get('/envelopes').set('Authorization', tokenB);
      expect(lista.body.livreCentavos).toBeLessThan(0);
      expect(lista.body.avisos).toContain('ALOCADO_ACIMA_DO_DISPONIVEL');
    });

    it('CA-11: nome repetido do mesmo usuário → 409 ENVELOPE_JA_EXISTE', async () => {
      const r = await http()
        .post('/envelopes')
        .set('Authorization', tokenA)
        .send({ nome: 'Viagem' });

      expect(r.status).toBe(409);
      expect(r.body.code ?? r.body.error?.code).toBe('ENVELOPE_JA_EXISTE');
    });

    it('CA-11: o mesmo nome em OUTRO usuário é permitido', async () => {
      const r = await http()
        .post('/envelopes')
        .set('Authorization', tokenB)
        .send({ nome: 'Viagem' });

      expect(r.status).toBe(201);
    });

    it.each([
      ['sem nome', {}],
      ['nome vazio', { nome: '' }],
      ['nome só espaços', { nome: '   ' }],
      ['nome com 61 caracteres', { nome: 'x'.repeat(61) }],
      ['nome null', { nome: null }],
      ['alocado negativo', { nome: 'X', alocadoCentavos: -1 }],
      ['alocado fracionário', { nome: 'X', alocadoCentavos: 1.5 }],
      ['alocado acima do limite', { nome: 'X', alocadoCentavos: 2_000_000_001 }],
      ['alocado texto', { nome: 'X', alocadoCentavos: 'abc' }],
      ['alocado null', { nome: 'X', alocadoCentavos: null }],
      ['meta 0', { nome: 'X', metaCentavos: 0 }],
      ['meta negativa', { nome: 'X', metaCentavos: -5 }],
      ['meta fracionária', { nome: 'X', metaCentavos: 10.5 }],
      ['meta acima do limite', { nome: 'X', metaCentavos: 2_000_000_001 }],
      ['campo extra', { nome: 'X', userId: A }],
    ])('CA-14: %s → 400 e nada é gravado', async (_nome, corpo) => {
      const r = await http().post('/envelopes').set('Authorization', tokenA).send(corpo);

      expect(r.status).toBe(400);
      expect(prisma.envelope.create).not.toHaveBeenCalled();
    });

    it('as bordas valem: nome com 60, alocado 0 e 2 bilhões, meta 1', async () => {
      const casos = [
        { nome: 'y'.repeat(60) },
        { nome: 'b1', alocadoCentavos: 0 },
        { nome: 'b2', alocadoCentavos: 2_000_000_000 },
        { nome: 'b3', metaCentavos: 1 },
      ];
      for (const corpo of casos) {
        const r = await http().post('/envelopes').set('Authorization', tokenB).send(corpo);
        expect(r.status).toBe(201);
      }
    });
  });

  describe('PATCH /envelopes/:id', () => {
    it('CA-12: parcial → 200, muda só o enviado', async () => {
      const r = await http()
        .patch(`/envelopes/${ID_A}`)
        .set('Authorization', tokenA)
        .send({ alocadoCentavos: 100_000 });

      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        nome: 'Viagem',
        alocadoCentavos: 100_000,
        metaCentavos: 100_000,
        progressoBp: 10_000,
        faltaCentavos: 0,
        atingida: true,
      });
    });

    it('CA-12: metaCentavos null remove a meta', async () => {
      const r = await http()
        .patch(`/envelopes/${ID_A}`)
        .set('Authorization', tokenA)
        .send({ metaCentavos: null });

      expect(r.status).toBe(200);
      expect(r.body.metaCentavos).toBeNull();
      expect(r.body.progressoBp).toBeNull();
    });

    it('CA-13: id de outro usuário → 404 e o envelope do A fica intacto', async () => {
      const r = await http()
        .patch(`/envelopes/${ID_A}`)
        .set('Authorization', tokenB)
        .send({ nome: 'Invadido', alocadoCentavos: 1 });

      expect(r.status).toBe(404);
      expect(r.body.code ?? r.body.error?.code).toBe('ENVELOPE_NAO_ENCONTRADO');
      expect(tabela[0]).toMatchObject({ nome: 'Viagem', alocadoCentavos: 30_000 });
    });

    it('CA-13: id inexistente → 404', async () => {
      const r = await http()
        .patch(`/envelopes/${ID_INEXISTENTE}`)
        .set('Authorization', tokenA)
        .send({ nome: 'X' });

      expect(r.status).toBe(404);
    });

    it('CA-14: id que não é UUID → 400', async () => {
      const r = await http()
        .patch('/envelopes/abc')
        .set('Authorization', tokenA)
        .send({ nome: 'X' });

      expect(r.status).toBe(400);
    });

    it('CA-11: renomear para um nome que já existe → 409', async () => {
      await http().post('/envelopes').set('Authorization', tokenA).send({ nome: 'Setup' });

      const r = await http()
        .patch(`/envelopes/${ID_A}`)
        .set('Authorization', tokenA)
        .send({ nome: 'Setup' });

      expect(r.status).toBe(409);
    });

    it.each([
      ['corpo vazio', {}, 200],
      ['nome null', { nome: null }, 400],
      ['nome vazio', { nome: '' }, 400],
      ['alocado null', { alocadoCentavos: null }, 400],
      ['alocado negativo', { alocadoCentavos: -1 }, 400],
      ['meta 0', { metaCentavos: 0 }, 400],
      ['campo extra', { userId: B }, 400],
    ])('CA-14: %s → %i', async (_nome, corpo, status) => {
      const r = await http().patch(`/envelopes/${ID_A}`).set('Authorization', tokenA).send(corpo);

      expect(r.status).toBe(status);
      if (status === 400) expect(prisma.envelope.update).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /envelopes/:id', () => {
    it('CA-12: 204 sem corpo e some do GET (o valor volta ao livre)', async () => {
      const r = await http().delete(`/envelopes/${ID_A}`).set('Authorization', tokenA);

      expect(r.status).toBe(204);
      expect(r.text).toBe('');
      const lista = await http().get('/envelopes').set('Authorization', tokenA);
      expect(lista.body.envelopes).toEqual([]);
      expect(lista.body.livreCentavos).toBe(104_545);
    });

    it('CA-13: de outro usuário → 404 e o envelope continua existindo', async () => {
      const r = await http().delete(`/envelopes/${ID_A}`).set('Authorization', tokenB);

      expect(r.status).toBe(404);
      expect(tabela).toHaveLength(1);
    });

    it('CA-14: id que não é UUID → 400', async () => {
      const r = await http().delete('/envelopes/abc').set('Authorization', tokenA);

      expect(r.status).toBe(400);
      expect(prisma.envelope.deleteMany).not.toHaveBeenCalled();
    });
  });
});
