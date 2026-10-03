import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CategorizacaoService } from './categorizacao.service';

function montar() {
  const prisma = {
    regraCategoria: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    transacao: {
      findMany: jest.fn().mockResolvedValue([]),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue(undefined),
    },
  };
  return { prisma, service: new CategorizacaoService(prisma as unknown as PrismaService) };
}

function linha(p: Record<string, unknown>) {
  return {
    id: 'id',
    descricao: 'Compra',
    tipo: 'DEBITO',
    categoriaPluggy: null,
    categoria: null,
    origemCategoria: null,
    ...p,
  };
}

describe('CategorizacaoService — regras', () => {
  it('CA-10: criarRegra aplica os defaults (tipo null, prioridade 0)', async () => {
    const { prisma, service } = montar();
    prisma.regraCategoria.create.mockResolvedValue({
      id: 'r1',
      padrao: 'padaria',
      categoria: 'MERCADO',
      tipo: null,
      prioridade: 0,
    });

    const r = await service.criarRegra({ padrao: 'padaria', categoria: 'MERCADO' });

    expect(prisma.regraCategoria.create).toHaveBeenCalledWith({
      data: { padrao: 'padaria', categoria: 'MERCADO', tipo: null, prioridade: 0 },
    });
    expect(r).toEqual({
      id: 'r1',
      padrao: 'padaria',
      categoria: 'MERCADO',
      tipo: null,
      prioridade: 0,
    });
  });

  it('CA-11: remover regra inexistente dá 404 REGRA_NAO_ENCONTRADA', async () => {
    const { prisma, service } = montar();
    prisma.regraCategoria.deleteMany.mockResolvedValue({ count: 0 });

    const erro = await service.removerRegra('x').catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(NotFoundException);
    expect((erro as NotFoundException).getResponse()).toMatchObject({
      code: 'REGRA_NAO_ENCONTRADA',
    });
  });

  it('CA-11: remover regra existente não lança', async () => {
    const { prisma, service } = montar();
    prisma.regraCategoria.deleteMany.mockResolvedValue({ count: 1 });

    await expect(service.removerRegra('r1')).resolves.toBeUndefined();
  });
});

describe('CategorizacaoService — categorizar e recalcular', () => {
  it('CA-15: categoriza as pendentes agrupando updates por (categoria, origem)', async () => {
    const { prisma, service } = montar();
    prisma.transacao.findMany.mockResolvedValue([
      linha({ id: 'a', descricao: 'Pagamento de fatura', categoriaPluggy: 'Transfers' }),
      linha({ id: 'b', descricao: 'Pagamento de fatura', categoriaPluggy: 'Transfers' }),
      linha({ id: 'c', categoriaPluggy: 'Groceries' }),
    ]);

    const n = await service.categorizarPendentes();

    expect(n).toBe(3);
    expect(prisma.transacao.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { categoria: null } }),
    );
    expect(prisma.transacao.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.transacao.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] } },
      data: { categoria: 'PAGAMENTO_FATURA', origemCategoria: 'REGRA_PADRAO' },
    });
  });

  it('sem pendentes não consulta regras nem atualiza', async () => {
    const { prisma, service } = montar();

    await expect(service.categorizarPendentes()).resolves.toBe(0);
    expect(prisma.regraCategoria.findMany).not.toHaveBeenCalled();
    expect(prisma.transacao.updateMany).not.toHaveBeenCalled();
  });

  it('CA-13: recalcular exclui MANUAL na consulta, altera só o que mudou e é estável na 2ª vez', async () => {
    const { prisma, service } = montar();
    prisma.regraCategoria.findMany.mockResolvedValue([
      {
        padrao: 'padaria',
        categoria: 'MERCADO',
        tipo: null,
        prioridade: 0,
        criadoEm: new Date('2026-01-01'),
      },
    ]);
    const mudou = linha({
      id: 'b',
      descricao: 'Padaria Central',
      categoriaPluggy: 'Shopping',
      categoria: 'COMPRAS',
      origemCategoria: 'REGRA_PADRAO',
    });
    const igual = linha({
      id: 'c',
      categoriaPluggy: 'Groceries',
      categoria: 'MERCADO',
      origemCategoria: 'REGRA_PADRAO',
    });
    prisma.transacao.findMany.mockResolvedValueOnce([mudou, igual]);

    const primeira = await service.recalcular();

    expect(prisma.transacao.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ origemCategoria: null }, { origemCategoria: { not: 'MANUAL' } }] },
      }),
    );
    expect(primeira).toEqual({ analisadas: 2, alteradas: 1 });
    expect(prisma.transacao.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['b'] } },
      data: { categoria: 'MERCADO', origemCategoria: 'REGRA_USUARIO' },
    });

    prisma.transacao.findMany.mockResolvedValueOnce([
      { ...mudou, categoria: 'MERCADO', origemCategoria: 'REGRA_USUARIO' },
      igual,
    ]);
    prisma.transacao.updateMany.mockClear();
    await expect(service.recalcular()).resolves.toEqual({ analisadas: 2, alteradas: 0 });
    expect(prisma.transacao.updateMany).not.toHaveBeenCalled();
  });

  it('CA-14: categorizarUma reavalia por regra e grava a origem', async () => {
    const { prisma, service } = montar();
    prisma.transacao.findUniqueOrThrow.mockResolvedValue(
      linha({
        id: 'a',
        categoriaPluggy: 'Pharmacy',
        categoria: 'LAZER',
        origemCategoria: 'MANUAL',
      }),
    );

    const r = await service.categorizarUma('a');

    expect(r).toEqual({ categoria: 'SAUDE', origemCategoria: 'REGRA_PADRAO' });
    expect(prisma.transacao.update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { categoria: 'SAUDE', origemCategoria: 'REGRA_PADRAO' },
    });
  });
});
