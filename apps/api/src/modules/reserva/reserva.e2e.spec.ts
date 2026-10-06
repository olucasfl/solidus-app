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
import { CarteiraService } from '../carteira/carteira.service';
import { PoupancaService } from '../poupanca/poupanca.service';
import { ReservaModule } from './reserva.module';

const SEGREDO_JWT = 'segredo-de-teste-para-access-token-32ch';
const A = 'user-a';
const B = 'user-b';

describe('reserva de emergência (e2e)', () => {
  let app: INestApplication;
  let tokenA: string;
  let tokenB: string;

  // O "banco" só devolve a configuração para o dono: é isso que prova o isolamento.
  const prisma = {
    configuracaoReserva: { findUnique: jest.fn(), upsert: jest.fn() },
  };
  const poupanca = { historico: jest.fn() };
  const carteira = { consultar: jest.fn() };

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
        ReservaModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_GUARD, useClass: ApiThrottlerGuard },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(PoupancaService)
      .useValue(poupanca)
      .overrideProvider(CarteiraService)
      .useValue(carteira)
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
    prisma.configuracaoReserva.findUnique.mockImplementation(
      async ({ where }: { where: { userId: string } }) =>
        where.userId === A ? { userId: A, meses: 12, base: 'LIQUIDA', janelaMeses: 3 } : null,
    );
    prisma.configuracaoReserva.upsert.mockImplementation(
      async ({ create }: { create: Record<string, unknown> }) => ({
        meses: 6,
        base: 'BRUTA',
        janelaMeses: 6,
        ...create,
      }),
    );
    poupanca.historico.mockResolvedValue({ meses: [] });
    carteira.consultar.mockResolvedValue({
      data: '2026-10-06',
      caixinhas: [],
      totais: { patrimonioCentavos: 0, investidoCentavos: 0, disponivelParaGastarCentavos: 0 },
      avisos: [],
    });
  });

  const http = () => request(app.getHttpServer());

  it.each([
    ['get', '/reserva-emergencia'],
    ['patch', '/reserva-emergencia/configuracao'],
  ] as const)('CA-16: %s %s sem access token → 401', async (metodo, rota) => {
    const r = await http()[metodo](rota).send({ meses: 3 });

    expect(r.status).toBe(401);
    expect(prisma.configuracaoReserva.findUnique).not.toHaveBeenCalled();
    expect(prisma.configuracaoReserva.upsert).not.toHaveBeenCalled();
  });

  describe('GET /reserva-emergencia', () => {
    it('200 com o contrato (sem despesas: SEM_GASTOS_NA_JANELA e NENHUMA_CAIXINHA_MARCADA)', async () => {
      const r = await http().get('/reserva-emergencia').set('Authorization', tokenA);

      expect(r.status).toBe(200);
      expect(Object.keys(r.body).sort()).toEqual(
        [
          'atingida',
          'avisos',
          'configuracao',
          'coberturaMesesCentesimos',
          'data',
          'faltaCentavos',
          'gasto',
          'metaCentavos',
          'reserva',
        ].sort(),
      );
      expect(r.body.avisos).toEqual(
        expect.arrayContaining(['SEM_GASTOS_NA_JANELA', 'NENHUMA_CAIXINHA_MARCADA']),
      );
      expect(r.body.data).toBe('2026-10-06');
    });

    it('usa a configuração do usuário da sessão (A: 12 meses, base LIQUIDA, janela 3)', async () => {
      const r = await http().get('/reserva-emergencia').set('Authorization', tokenA);

      expect(r.body.configuracao).toEqual({ meses: 12, base: 'LIQUIDA', janelaMeses: 3 });
    });

    it('CA-15: o usuário B não vê a configuração do A (cai nos padrões) e o dono vem da SESSÃO', async () => {
      const r = await http().get(`/reserva-emergencia?userId=${A}`).set('Authorization', tokenB);

      expect(r.status).toBe(200);
      expect(r.body.configuracao).toEqual({ meses: 6, base: 'BRUTA', janelaMeses: 6 });
      expect(prisma.configuracaoReserva.findUnique).toHaveBeenCalledWith({ where: { userId: B } });
      expect(carteira.consultar).toHaveBeenCalledWith(B);
    });

    it('é só leitura: GET nunca grava', async () => {
      await http().get('/reserva-emergencia').set('Authorization', tokenA);

      expect(prisma.configuracaoReserva.upsert).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /reserva-emergencia/configuracao', () => {
    it('CA-12: válido → 200 com a configuração e grava com o userId da sessão', async () => {
      const r = await http()
        .patch('/reserva-emergencia/configuracao')
        .set('Authorization', tokenB)
        .send({ meses: 3, base: 'LIQUIDA', janelaMeses: 12 });

      expect(r.status).toBe(200);
      expect(r.body).toEqual({ meses: 3, base: 'LIQUIDA', janelaMeses: 12 });
      expect(prisma.configuracaoReserva.upsert.mock.calls[0]![0].where).toEqual({ userId: B });
    });

    it.each([
      ['meses 0', { meses: 0 }],
      ['meses 61', { meses: 61 }],
      ['meses fracionário', { meses: 1.5 }],
      ['meses texto', { meses: 'abc' }],
      ['meses null', { meses: null }],
      ['janelaMeses 0', { janelaMeses: 0 }],
      ['janelaMeses 25', { janelaMeses: 25 }],
      ['janelaMeses null', { janelaMeses: null }],
      ['base desconhecida', { base: 'OUTRA' }],
      ['base minúscula', { base: 'bruta' }],
      ['base null', { base: null }],
      ['corpo vazio', {}],
      ['campo extra', { meses: 3, usuario: 'x' }],
      ['só campo extra', { qualquer: 1 }],
    ])('CA-12: %s → 400 e nada é gravado', async (_nome, corpo) => {
      const r = await http()
        .patch('/reserva-emergencia/configuracao')
        .set('Authorization', tokenA)
        .send(corpo);

      expect(r.status).toBe(400);
      expect(prisma.configuracaoReserva.upsert).not.toHaveBeenCalled();
    });

    it('as bordas das faixas valem: meses 1 e 60, janelaMeses 1 e 24', async () => {
      for (const corpo of [{ meses: 1 }, { meses: 60 }, { janelaMeses: 1 }, { janelaMeses: 24 }]) {
        const r = await http()
          .patch('/reserva-emergencia/configuracao')
          .set('Authorization', tokenA)
          .send(corpo);
        expect(r.status).toBe(200);
      }
    });
  });
});
