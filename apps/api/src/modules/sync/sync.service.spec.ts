import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { type ContaPluggy, type TransacaoPluggy } from '../../domain/sync/mapear';
import { type EnvironmentVariables } from '../../config/env.validation';
import { PrismaService } from '../../database/prisma.service';
import { type CategorizacaoService } from '../categorizacao/categorizacao.service';
import { PluggyGateway, PluggySdkGateway } from './pluggy.gateway';
import {
  PluggyIndisponivelError,
  PluggyNaoConfiguradoError,
  SyncEmAndamentoError,
} from './sync-errors';
import { SyncService } from './sync.service';

const U = 'u1';

const CONTA_CORRENTE: ContaPluggy = {
  id: 'pl-conta-1',
  type: 'BANK',
  subtype: 'CHECKING_ACCOUNT',
  name: 'Conta de teste',
  balance: 100.5,
  currencyCode: 'BRL',
};
const CONTA_DESCONHECIDA: ContaPluggy = { ...CONTA_CORRENTE, id: 'pl-conta-x', subtype: 'OUTRO' };

function tx(id: string, parcial: Partial<TransacaoPluggy> = {}): TransacaoPluggy {
  return {
    id,
    date: '2026-09-20T00:00:00.000Z',
    description: 'Lançamento de teste',
    type: 'DEBIT',
    amount: -10,
    amountInAccountCurrency: null,
    currencyCode: 'BRL',
    category: null,
    ...parcial,
  };
}

function montar(itemId: string | undefined = 'item-1') {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: U }) },
    conta: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ id: 'conta-db-1' }),
    },
    transacao: {
      aggregate: jest.fn().mockResolvedValue({ _max: { data: null } }),
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue(undefined),
    },
    syncRun: { create: jest.fn().mockResolvedValue(undefined), findFirst: jest.fn() },
  };
  const gateway = {
    listarContas: jest.fn().mockResolvedValue([CONTA_CORRENTE]),
    listarTransacoes: jest.fn().mockResolvedValue([]),
  };
  const config = {
    get: jest.fn((chave: string) => (chave === 'SEED_USER_EMAIL' ? 'dono@exemplo.com' : itemId)),
  };
  const categorizacao = { categorizarPendentes: jest.fn().mockResolvedValue(0) };
  const service = new SyncService(
    prisma as unknown as PrismaService,
    gateway as unknown as PluggyGateway,
    config as unknown as ConfigService<EnvironmentVariables, true>,
    categorizacao as unknown as CategorizacaoService,
  );
  return { prisma, gateway, categorizacao, service };
}

describe('SyncService.sincronizar', () => {
  it('CA-06: primeiro sync busca tudo (sem dateFrom) e conta as novas', async () => {
    const { prisma, gateway, service } = montar();
    gateway.listarTransacoes.mockResolvedValue([tx('t1'), tx('t2'), tx('t3')]);

    const r = await service.sincronizar();

    expect(gateway.listarTransacoes).toHaveBeenCalledWith('pl-conta-1', undefined);
    expect(r).toMatchObject({ contas: 1, transacoesNovas: 3, transacoesAtualizadas: 0 });
    expect(prisma.transacao.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it('CA-07: segundo sync com tudo igual não cria nem atualiza nada', async () => {
    const { prisma, gateway, service } = montar();
    gateway.listarTransacoes.mockResolvedValue([tx('t1')]);
    prisma.transacao.findMany.mockResolvedValue([
      {
        pluggyTransactionId: 't1',
        data: new Date('2026-09-20T00:00:00.000Z'),
        descricao: 'Lançamento de teste',
        valorCentavos: -1000,
        status: 'EFETIVADA',
        categoriaPluggy: null,
      },
    ]);

    const r = await service.sincronizar();

    expect(r).toMatchObject({ transacoesNovas: 0, transacoesAtualizadas: 0 });
    expect(prisma.transacao.createMany).not.toHaveBeenCalled();
    expect(prisma.transacao.update).not.toHaveBeenCalled();
  });

  it('CA-07: transação pendente que virou efetivada é atualizada', async () => {
    const { prisma, gateway, service } = montar();
    gateway.listarTransacoes.mockResolvedValue([tx('t1', { status: 'POSTED' })]);
    prisma.transacao.findMany.mockResolvedValue([
      {
        pluggyTransactionId: 't1',
        data: new Date('2026-09-20T00:00:00.000Z'),
        descricao: 'Lançamento de teste',
        valorCentavos: -1000,
        status: 'PENDENTE',
        categoriaPluggy: null,
      },
    ]);

    const r = await service.sincronizar();

    expect(r.transacoesAtualizadas).toBe(1);
    expect(prisma.transacao.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pluggyTransactionId: 't1', userId: U },
        data: expect.objectContaining({ status: 'EFETIVADA' }),
      }),
    );
  });

  it('CA-08: sync incremental usa a data mais recente menos 30 dias', async () => {
    const { prisma, gateway, service } = montar();
    prisma.transacao.aggregate.mockResolvedValue({
      _max: { data: new Date('2026-09-20T00:00:00.000Z') },
    });

    await service.sincronizar();

    expect(gateway.listarTransacoes).toHaveBeenCalledWith('pl-conta-1', '2026-08-21');
  });

  it('CA-13: ignora conta de tipo desconhecido', async () => {
    const { prisma, gateway, service } = montar();
    gateway.listarContas.mockResolvedValue([CONTA_DESCONHECIDA, CONTA_CORRENTE]);

    const r = await service.sincronizar();

    expect(r.contas).toBe(1);
    expect(prisma.conta.upsert).toHaveBeenCalledTimes(1);
    expect(gateway.listarTransacoes).toHaveBeenCalledTimes(1);
  });

  it('conta transações em moeda estrangeira sem conversão', async () => {
    const { gateway, service } = montar();
    gateway.listarTransacoes.mockResolvedValue([
      tx('t1', { currencyCode: 'USD', amountInAccountCurrency: null }),
      tx('t2', { currencyCode: 'USD', amountInAccountCurrency: 10 }),
    ]);

    expect((await service.sincronizar()).semConversao).toBe(1);
  });

  it('CA-14: grava SyncRun de sucesso com os contadores', async () => {
    const { prisma, gateway, service } = montar();
    gateway.listarTransacoes.mockResolvedValue([tx('t1')]);

    await service.sincronizar();

    expect(prisma.syncRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'SUCESSO',
        contas: 1,
        transacoesNovas: 1,
        erro: null,
      }),
    });
  });

  it('CA-11: falha do gateway grava SyncRun FALHA com o code e propaga o erro', async () => {
    const { prisma, gateway, service } = montar();
    gateway.listarContas.mockRejectedValue(new PluggyIndisponivelError());

    await expect(service.sincronizar()).rejects.toThrow(PluggyIndisponivelError);
    expect(prisma.syncRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'FALHA', erro: 'PLUGGY_INDISPONIVEL' }),
    });
  });

  it('erro inesperado grava ERRO_INTERNO', async () => {
    const { prisma, service } = montar();
    prisma.conta.upsert.mockRejectedValue(new Error('segredo do banco'));

    await expect(service.sincronizar()).rejects.toThrow('segredo do banco');
    expect(prisma.syncRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'FALHA', erro: 'ERRO_INTERNO' }),
    });
  });

  it('CA-15: categoriza as pendentes ao fim; se a categorização falhar, o sync segue 200', async () => {
    const { categorizacao, service } = montar();
    await service.sincronizar();
    expect(categorizacao.categorizarPendentes).toHaveBeenCalledTimes(1);

    categorizacao.categorizarPendentes.mockRejectedValue(new Error('detalhe interno'));
    await expect(service.sincronizar()).resolves.toMatchObject({ contas: 1 });
  });

  it('CA-12: sem PLUGGY_ITEM_ID responde 503 e não chama o gateway', async () => {
    const { gateway, service } = montar('');

    await expect(service.sincronizar()).rejects.toThrow(PluggyNaoConfiguradoError);
    expect(gateway.listarContas).not.toHaveBeenCalled();
  });

  it('CA-10: segundo sync durante um em andamento dá SyncEmAndamentoError, e a trava solta no fim', async () => {
    const { gateway, service } = montar();
    let liberar!: () => void;
    gateway.listarContas.mockReturnValue(
      new Promise<ContaPluggy[]>((resolve) => {
        liberar = () => resolve([]);
      }),
    );

    const primeiro = service.sincronizar();
    await Promise.resolve();
    await expect(service.sincronizar()).rejects.toThrow(SyncEmAndamentoError);

    liberar();
    await primeiro;
    gateway.listarContas.mockResolvedValue([]);
    await expect(service.sincronizar()).resolves.toBeDefined();
  });

  it('a trava também solta quando o sync falha', async () => {
    const { gateway, service } = montar();
    gateway.listarContas.mockRejectedValueOnce(new PluggyIndisponivelError());

    await expect(service.sincronizar()).rejects.toThrow();
    gateway.listarContas.mockResolvedValue([]);
    await expect(service.sincronizar()).resolves.toBeDefined();
  });
});

describe('SyncService.status', () => {
  it('CA-14: sem nenhum sync devolve ultimoSync null', async () => {
    const { prisma, service } = montar();
    prisma.syncRun.findFirst.mockResolvedValue(null);

    await expect(service.status(U)).resolves.toEqual({ ultimoSync: null });
  });

  it('CA-14: devolve o último SyncRun', async () => {
    const { prisma, service } = montar();
    prisma.syncRun.findFirst.mockResolvedValue({
      iniciadoEm: new Date('2026-10-03T03:00:00.000Z'),
      finalizadoEm: new Date('2026-10-03T03:00:05.000Z'),
      status: 'SUCESSO',
      contas: 2,
      transacoesNovas: 10,
      transacoesAtualizadas: 1,
    });

    await expect(service.status(U)).resolves.toEqual({
      ultimoSync: {
        iniciadoEm: '2026-10-03T03:00:00.000Z',
        finalizadoEm: '2026-10-03T03:00:05.000Z',
        status: 'SUCESSO',
        contas: 2,
        transacoesNovas: 10,
        transacoesAtualizadas: 1,
      },
    });
  });
});

describe('PluggySdkGateway (CA-16: só leitura)', () => {
  const fonte = readFileSync(resolve(__dirname, 'pluggy.gateway.ts'), 'utf8');

  it('só chama métodos de leitura do SDK', () => {
    const chamadas = [...fonte.matchAll(/\.(fetch\w+|create\w+|update\w+|delete\w+)\(/g)].map(
      (m) => m[1],
    );
    expect(chamadas.length).toBeGreaterThan(0);
    expect(chamadas.every((nome) => nome!.startsWith('fetch'))).toBe(true);
  });

  it('a implementação só expõe métodos listar*', () => {
    const metodos = Object.getOwnPropertyNames(PluggySdkGateway.prototype).filter(
      (n) => n !== 'constructor' && !['sdk', 'executar'].includes(n),
    );
    expect(metodos.sort()).toEqual(['listarContas', 'listarTransacoes']);
  });
});
