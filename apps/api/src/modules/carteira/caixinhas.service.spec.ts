import { BadRequestException } from '@nestjs/common';
import * as relogio from '../../common/relogio';
import { PrismaService } from '../../database/prisma.service';
import {
  CaixinhaNaoEncontradaError,
  MovimentoNaoEncontradoError,
  TransacaoInvalidaError,
  TransacaoJaVinculadaError,
} from './carteira-errors';
import { CaixinhasService } from './caixinhas.service';

function montar() {
  const prisma = {
    caixinha: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ id: 'c1' }),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    movimentoCaixinha: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'm1', criadoEm: new Date(), ...data }),
        ),
      deleteMany: jest.fn(),
    },
    transacao: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
  };
  return { prisma, service: new CaixinhasService(prisma as unknown as PrismaService) };
}

beforeEach(() => {
  jest.spyOn(relogio, 'hojeUtc').mockReturnValue('2026-10-05');
});
afterEach(() => jest.restoreAllMocks());

const caixinhaBanco = {
  id: 'c1',
  nome: 'Turbo',
  percentualCdiBp: 11_500,
  reservaDeGastos: false,
  ativa: true,
  criadoEm: new Date(),
  atualizadoEm: new Date(),
};

describe('CaixinhasService — Caixinhas (CA-13)', () => {
  it('criar aplica os defaults e devolve o contrato (sem campos internos)', async () => {
    const { prisma, service } = montar();
    prisma.caixinha.create.mockResolvedValue(caixinhaBanco);

    const r = await service.criar({ nome: 'Turbo', percentualCdiBp: 11_500 });

    expect(prisma.caixinha.create).toHaveBeenCalledWith({
      data: { nome: 'Turbo', percentualCdiBp: 11_500, reservaDeGastos: false },
    });
    expect(r).toEqual({
      id: 'c1',
      nome: 'Turbo',
      percentualCdiBp: 11_500,
      reservaDeGastos: false,
      ativa: true,
    });
  });

  it('atualizar muda só os campos enviados; 404 se não existe', async () => {
    const { prisma, service } = montar();
    prisma.caixinha.update.mockResolvedValue({ ...caixinhaBanco, ativa: false });

    await service.atualizar('c1', { ativa: false });
    expect(prisma.caixinha.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { ativa: false },
    });

    prisma.caixinha.findUnique.mockResolvedValue(null);
    await expect(service.atualizar('x', { nome: 'Y' })).rejects.toThrow(CaixinhaNaoEncontradaError);
  });

  it('remover: 404 se não existe', async () => {
    const { prisma, service } = montar();
    prisma.caixinha.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.remover('x')).rejects.toThrow(CaixinhaNaoEncontradaError);

    prisma.caixinha.deleteMany.mockResolvedValueOnce({ count: 1 });
    await expect(service.remover('c1')).resolves.toBeUndefined();
  });

  it('removerMovimento: 404 se não existe', async () => {
    const { prisma, service } = montar();
    prisma.movimentoCaixinha.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.removerMovimento('x')).rejects.toThrow(MovimentoNaoEncontradoError);
  });

  it('listarMovimentos exige a Caixinha', async () => {
    const { prisma, service } = montar();
    prisma.caixinha.findUnique.mockResolvedValue(null);

    await expect(service.listarMovimentos('x')).rejects.toThrow(CaixinhaNaoEncontradaError);
  });
});

describe('CaixinhasService — movimentos (CA-14)', () => {
  const ok = { tipo: 'SALDO', data: '2026-10-01', valorCentavos: 100_000 } as const;

  it('grava SALDO com a data como data de calendário (meia-noite UTC)', async () => {
    const { prisma, service } = montar();

    const r = await service.criarMovimento('c1', { ...ok, dataOrigem: '2025-01-10' });

    expect(prisma.movimentoCaixinha.create).toHaveBeenCalledWith({
      data: {
        caixinhaId: 'c1',
        tipo: 'SALDO',
        data: new Date('2026-10-01T00:00:00.000Z'),
        valorCentavos: 100_000,
        dataOrigem: new Date('2025-01-10T00:00:00.000Z'),
        transacaoId: null,
      },
    });
    expect(r).toMatchObject({
      data: '2026-10-01',
      dataOrigem: '2025-01-10',
      valorCentavos: 100_000,
    });
  });

  it('SALDO com valor 0 é válido; APORTE e RESGATE com 0 não', async () => {
    const { service } = montar();

    await expect(
      service.criarMovimento('c1', { tipo: 'SALDO', data: '2026-10-01', valorCentavos: 0 }),
    ).resolves.toBeDefined();
    for (const tipo of ['APORTE', 'RESGATE'] as const) {
      await expect(
        service.criarMovimento('c1', { tipo, data: '2026-10-01', valorCentavos: 0 }),
      ).rejects.toThrow(BadRequestException);
    }
  });

  it('rejeita data futura, data inexistente e data de hoje é aceita', async () => {
    const { prisma, service } = montar();

    await expect(service.criarMovimento('c1', { ...ok, data: '2026-10-06' })).rejects.toMatchObject(
      {
        response: { code: 'DATA_FUTURA' },
      },
    );
    await expect(service.criarMovimento('c1', { ...ok, data: '2026-02-30' })).rejects.toMatchObject(
      {
        response: { code: 'DATA_INVALIDA' },
      },
    );
    await expect(
      service.criarMovimento('c1', { ...ok, data: '2026-10-05' }),
    ).resolves.toBeDefined();
    expect(prisma.movimentoCaixinha.create).toHaveBeenCalledTimes(1);
  });

  it('dataOrigem só em SALDO e nunca depois da data do saldo', async () => {
    const { service } = montar();

    await expect(
      service.criarMovimento('c1', {
        tipo: 'APORTE',
        data: '2026-10-01',
        valorCentavos: 5,
        dataOrigem: '2026-09-01',
      }),
    ).rejects.toMatchObject({ response: { code: 'DATA_ORIGEM_INVALIDA' } });
    await expect(
      service.criarMovimento('c1', { ...ok, dataOrigem: '2026-10-02' }),
    ).rejects.toMatchObject({ response: { code: 'DATA_ORIGEM_INVALIDA' } });
  });

  it('sem valor e sem transação é erro VALOR_OBRIGATORIO', async () => {
    const { service } = montar();

    await expect(
      service.criarMovimento('c1', { tipo: 'APORTE', data: '2026-10-01' }),
    ).rejects.toMatchObject({ response: { code: 'VALOR_OBRIGATORIO' } });
  });

  it('Caixinha inexistente → 404 antes de qualquer outra validação', async () => {
    const { prisma, service } = montar();
    prisma.caixinha.findUnique.mockResolvedValue(null);

    await expect(service.criarMovimento('x', ok)).rejects.toThrow(CaixinhaNaoEncontradaError);
  });
});

describe('CaixinhasService — vínculo com transação do sync (CA-15)', () => {
  const transacao = (p: Record<string, unknown> = {}) => ({
    id: 't1',
    categoria: 'INVESTIMENTO',
    tipo: 'DEBITO',
    valorCentavos: -250_000,
    movimentoCaixinha: null,
    ...p,
  });
  const aporte = { tipo: 'APORTE', data: '2026-10-01', transacaoId: 't1' } as const;

  it('APORTE de uma saída: assume o módulo da transação e grava o vínculo', async () => {
    const { prisma, service } = montar();
    prisma.transacao.findUnique.mockResolvedValue(transacao());

    const r = await service.criarMovimento('c1', aporte);

    expect(r).toMatchObject({ tipo: 'APORTE', valorCentavos: 250_000, transacaoId: 't1' });
  });

  it('um valor informado vence o da transação', async () => {
    const { prisma, service } = montar();
    prisma.transacao.findUnique.mockResolvedValue(transacao());

    const r = await service.criarMovimento('c1', { ...aporte, valorCentavos: 100_000 });

    expect(r.valorCentavos).toBe(100_000);
  });

  it('RESGATE corresponde a uma ENTRADA; o sentido errado dá 422', async () => {
    const { prisma, service } = montar();
    prisma.transacao.findUnique.mockResolvedValue(transacao());

    await expect(service.criarMovimento('c1', { ...aporte, tipo: 'RESGATE' })).rejects.toThrow(
      TransacaoInvalidaError,
    );

    prisma.transacao.findUnique.mockResolvedValue(
      transacao({ tipo: 'CREDITO', valorCentavos: 90_000 }),
    );
    await expect(service.criarMovimento('c1', aporte)).rejects.toThrow(TransacaoInvalidaError);
    await expect(
      service.criarMovimento('c1', { ...aporte, tipo: 'RESGATE' }),
    ).resolves.toMatchObject({ valorCentavos: 90_000 });
  });

  it('já vinculada → 409; inexistente, de outra categoria ou com SALDO → 422', async () => {
    const { prisma, service } = montar();

    prisma.transacao.findUnique.mockResolvedValue(transacao({ movimentoCaixinha: { id: 'm9' } }));
    await expect(service.criarMovimento('c1', aporte)).rejects.toThrow(TransacaoJaVinculadaError);

    prisma.transacao.findUnique.mockResolvedValue(null);
    await expect(service.criarMovimento('c1', aporte)).rejects.toThrow(TransacaoInvalidaError);

    prisma.transacao.findUnique.mockResolvedValue(transacao({ categoria: 'MERCADO' }));
    await expect(service.criarMovimento('c1', aporte)).rejects.toThrow(TransacaoInvalidaError);

    prisma.transacao.findUnique.mockResolvedValue(transacao());
    await expect(
      service.criarMovimento('c1', { ...aporte, tipo: 'SALDO', valorCentavos: 5 }),
    ).rejects.toThrow(TransacaoInvalidaError);
  });
});

describe('CaixinhasService.sugestoes (CA-16)', () => {
  it('lista INVESTIMENTO não vinculada desde a data, com o sentido sugerido', async () => {
    const { prisma, service } = montar();
    prisma.transacao.findMany.mockResolvedValue([
      {
        id: 't1',
        data: new Date('2026-09-30T00:00:00Z'),
        descricao: 'Aplicação RDB',
        valorCentavos: -5_000,
        tipo: 'DEBITO',
      },
      {
        id: 't2',
        data: new Date('2026-09-29T00:00:00Z'),
        descricao: 'Resgate RDB',
        valorCentavos: 1_200,
        tipo: 'CREDITO',
      },
    ]);

    const r = await service.sugestoes('2026-09-01');

    expect(prisma.transacao.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          categoria: 'INVESTIMENTO',
          data: { gte: new Date('2026-09-01T00:00:00.000Z') },
          movimentoCaixinha: null,
        },
      }),
    );
    expect(r).toEqual([
      {
        transacaoId: 't1',
        data: '2026-09-30',
        descricao: 'Aplicação RDB',
        valorCentavos: 5_000,
        tipo: 'DEBITO',
        sugestao: 'APORTE',
      },
      {
        transacaoId: 't2',
        data: '2026-09-29',
        descricao: 'Resgate RDB',
        valorCentavos: 1_200,
        tipo: 'CREDITO',
        sugestao: 'RESGATE',
      },
    ]);
  });

  it('data inválida é erro', async () => {
    const { service } = montar();

    await expect(service.sugestoes('2026-13-01')).rejects.toMatchObject({
      response: { code: 'DATA_INVALIDA' },
    });
  });
});
