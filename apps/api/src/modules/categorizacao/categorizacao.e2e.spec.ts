import { type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { AccessGuard } from '../../common/guards/access.guard';
import { ApiThrottlerGuard } from '../../common/guards/api-throttler.guard';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { PrismaModule } from '../../database/prisma.module';
import { PrismaService } from '../../database/prisma.service';
import { TransacoesModule } from '../transacoes/transacoes.module';
import { CategorizacaoModule } from './categorizacao.module';

const SEGREDO_JWT = 'segredo-de-teste-para-access-token-32ch';
const UUID = '3f2b8c1e-5a7d-4e0f-9b6a-1c2d3e4f5a6b';

describe('categorização e transações (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let auth: string;
  const prisma = {
    fonteRenda: { findMany: jest.fn().mockResolvedValue([]) },
    regraCategoria: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    transacao: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ NODE_ENV: 'test', JWT_ACCESS_SECRET: SEGREDO_JWT })],
        }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
        JwtModule.register({}),
        PrismaModule,
        CategorizacaoModule,
        TransacoesModule,
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

    const jwt = await moduleRef
      .get(JwtService, { strict: false })
      .signAsync({ sub: 'user-1' }, { secret: SEGREDO_JWT, expiresIn: 300 });
    auth = `Bearer ${jwt}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prisma.regraCategoria.create.mockReset();
    prisma.transacao.findFirst.mockReset();
    prisma.transacao.update.mockClear();
    prisma.transacao.count.mockClear();
  });

  const http = () => request(app.getHttpServer());

  it('CA-17: todas as rotas exigem access token', async () => {
    const chamadas = [
      () => http().get('/categorias'),
      () => http().get('/regras'),
      () => http().post('/regras').send({ padrao: 'x', categoria: 'MERCADO' }),
      () => http().patch(`/regras/${UUID}`).send({ prioridade: 1 }),
      () => http().delete(`/regras/${UUID}`),
      () => http().patch(`/transacoes/${UUID}/categoria`).send({ categoria: 'LAZER' }),
      () => http().post('/categorizacao/recalcular'),
      () => http().get('/transacoes'),
    ];
    for (const chamada of chamadas) {
      expect((await chamada()).status).toBe(401);
    }
  });

  it('GET /categorias devolve a taxonomia completa', async () => {
    const r = await http().get('/categorias').set('Authorization', auth);

    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(23);
    expect(r.body[0]).toEqual({ id: 'MORADIA', nome: 'Moradia', natureza: 'DESPESA' });
  });

  describe('POST /regras', () => {
    it.each([
      ['padrão vazio', { padrao: '', categoria: 'MERCADO' }],
      ['padrão só espaços', { padrao: '    ', categoria: 'MERCADO' }],
      ['padrão com 121 caracteres', { padrao: 'a'.repeat(121), categoria: 'MERCADO' }],
      ['categoria inexistente', { padrao: 'x', categoria: 'XYZ' }],
      ['tipo inválido', { padrao: 'x', categoria: 'MERCADO', tipo: 'OUTRO' }],
      ['prioridade 1001', { padrao: 'x', categoria: 'MERCADO', prioridade: 1001 }],
      ['faixa negativa', { padrao: 'x', categoria: 'MERCADO', valorMinCentavos: -1 }],
      ['faixa não inteira', { padrao: 'x', categoria: 'MERCADO', valorMaxCentavos: 10.5 }],
      ['campo extra', { padrao: 'x', categoria: 'MERCADO', admin: true }],
    ])('CA-10: %s → 400 e nada é gravado', async (_nome, corpo) => {
      const r = await http().post('/regras').set('Authorization', auth).send(corpo);

      expect(r.status).toBe(400);
      expect(prisma.regraCategoria.create).not.toHaveBeenCalled();
    });

    it('CA-10: regra válida → 201 (padrão com trim)', async () => {
      prisma.regraCategoria.create.mockResolvedValue({
        id: UUID,
        padrao: 'padaria',
        categoria: 'MERCADO',
        tipo: 'DEBITO',
        prioridade: 3,
      });

      const r = await http()
        .post('/regras')
        .set('Authorization', auth)
        .send({ padrao: '  padaria  ', categoria: 'MERCADO', tipo: 'DEBITO', prioridade: 3 });

      expect(r.status).toBe(201);
      expect(prisma.regraCategoria.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          padrao: 'padaria',
          categoria: 'MERCADO',
          tipo: 'DEBITO',
          valorMinCentavos: null,
          valorMaxCentavos: null,
          prioridade: 3,
        },
      });
    });
  });

  describe('PATCH /regras/:id', () => {
    it.each([
      ['tipo inválido', { tipo: 'OUTRO' }],
      ['categoria inexistente', { categoria: 'XYZ' }],
      ['prioridade 2000', { prioridade: 2000 }],
      ['limite não inteiro', { valorMaxCentavos: 1.5 }],
      ['padrão vazio', { padrao: '' }],
      ['campo extra', { admin: true }],
    ])('CA-24: %s → 400 sem tocar o banco', async (_nome, corpo) => {
      prisma.regraCategoria.update.mockClear();

      const r = await http().patch(`/regras/${UUID}`).set('Authorization', auth).send(corpo);

      expect(r.status).toBe(400);
      expect(prisma.regraCategoria.update).not.toHaveBeenCalled();
    });

    it('CA-24: id não-UUID dá 400; inexistente 404; válida 200 e aceita null para limpar a faixa', async () => {
      expect(
        (
          await http()
            .patch('/regras/nao-e-uuid')
            .set('Authorization', auth)
            .send({ prioridade: 1 })
        ).status,
      ).toBe(400);

      prisma.regraCategoria.findFirst.mockResolvedValueOnce(null);
      const nao = await http()
        .patch(`/regras/${UUID}`)
        .set('Authorization', auth)
        .send({ prioridade: 1 });
      expect(nao.status).toBe(404);
      expect(nao.body.code).toBe('REGRA_NAO_ENCONTRADA');

      const existente = {
        id: UUID,
        padrao: 'x',
        categoria: 'SALARIO',
        tipo: 'CREDITO',
        valorMinCentavos: 1,
        valorMaxCentavos: 2,
        prioridade: 0,
      };
      prisma.regraCategoria.findFirst.mockResolvedValueOnce(existente);
      prisma.regraCategoria.update.mockResolvedValueOnce({
        ...existente,
        valorMinCentavos: null,
        valorMaxCentavos: null,
      });
      const ok = await http()
        .patch(`/regras/${UUID}`)
        .set('Authorization', auth)
        .send({ valorMinCentavos: null, valorMaxCentavos: null });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ valorMinCentavos: null, valorMaxCentavos: null });
    });
  });

  describe('DELETE /regras/:id', () => {
    it('CA-11: existente 204; inexistente 404 REGRA_NAO_ENCONTRADA; id inválido 400', async () => {
      const prismaRegra = prisma.regraCategoria.deleteMany;
      prismaRegra.mockResolvedValueOnce({ count: 1 });
      expect((await http().delete(`/regras/${UUID}`).set('Authorization', auth)).status).toBe(204);

      prismaRegra.mockResolvedValueOnce({ count: 0 });
      const nao = await http().delete(`/regras/${UUID}`).set('Authorization', auth);
      expect(nao.status).toBe(404);
      expect(nao.body.code).toBe('REGRA_NAO_ENCONTRADA');

      expect((await http().delete('/regras/nao-e-uuid').set('Authorization', auth)).status).toBe(
        400,
      );
    });
  });

  describe('PATCH /transacoes/:id/categoria', () => {
    it('CA-12: válida 200 MANUAL; inexistente 404; categoria inválida, ausente e id inválido 400', async () => {
      prisma.transacao.findFirst.mockResolvedValueOnce({ id: UUID });
      const ok = await http()
        .patch(`/transacoes/${UUID}/categoria`)
        .set('Authorization', auth)
        .send({ categoria: 'LAZER' });
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ id: UUID, categoria: 'LAZER', origemCategoria: 'MANUAL' });

      prisma.transacao.findFirst.mockResolvedValueOnce(null);
      const nao = await http()
        .patch(`/transacoes/${UUID}/categoria`)
        .set('Authorization', auth)
        .send({ categoria: 'LAZER' });
      expect(nao.status).toBe(404);
      expect(nao.body.code).toBe('TRANSACAO_NAO_ENCONTRADA');

      for (const corpo of [{ categoria: 'XYZ' }, {}, { categoria: 5 }]) {
        const r = await http()
          .patch(`/transacoes/${UUID}/categoria`)
          .set('Authorization', auth)
          .send(corpo);
        expect(r.status).toBe(400);
      }
      const ruim = await http()
        .patch('/transacoes/nao-e-uuid/categoria')
        .set('Authorization', auth)
        .send({ categoria: 'LAZER' });
      expect(ruim.status).toBe(400);
    });

    it('CA-14: categoria null devolve o resultado das regras', async () => {
      prisma.transacao.findFirst.mockResolvedValueOnce({ id: UUID });
      prisma.transacao.findFirstOrThrow.mockResolvedValueOnce({
        id: UUID,
        descricao: 'Farmácia',
        tipo: 'DEBITO',
        categoriaPluggy: 'Pharmacy',
        categoria: 'LAZER',
        origemCategoria: 'MANUAL',
      });

      const r = await http()
        .patch(`/transacoes/${UUID}/categoria`)
        .set('Authorization', auth)
        .send({ categoria: null });

      expect(r.status).toBe(200);
      expect(r.body).toEqual({ id: UUID, categoria: 'SAUDE', origemCategoria: 'REGRA_PADRAO' });
    });
  });

  describe('GET /transacoes', () => {
    it.each([
      ['mes=2026-13'],
      ['mes=2026-9'],
      ['limite=500'],
      ['limite=0'],
      ['pagina=0'],
      ['pagina=abc'],
      ['categoria=XYZ'],
    ])('CA-16: ?%s → 400 sem consultar o banco', async (query) => {
      const r = await http().get(`/transacoes?${query}`).set('Authorization', auth);

      expect(r.status).toBe(400);
      expect(prisma.transacao.count).not.toHaveBeenCalled();
    });

    it('CA-16: filtros válidos → 200 com paginação', async () => {
      prisma.transacao.count.mockResolvedValueOnce(7);

      const r = await http()
        .get('/transacoes?mes=2026-09&categoria=MERCADO&limite=2&pagina=1')
        .set('Authorization', auth);

      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ total: 7, pagina: 1, limite: 2, itens: [] });
    });
  });

  it('POST /categorizacao/recalcular → 200 { analisadas, alteradas }', async () => {
    const r = await http().post('/categorizacao/recalcular').set('Authorization', auth);

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ analisadas: 0, alteradas: 0 });
  });
});
