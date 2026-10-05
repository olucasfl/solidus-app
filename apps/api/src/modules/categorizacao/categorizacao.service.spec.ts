import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CategorizacaoService } from './categorizacao.service';

const U = 'u1';

function montar() {
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
      findMany: jest.fn().mockResolvedValue([]),
      findFirstOrThrow: jest.fn(),
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
    valorCentavos: -1000,
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
      valorMinCentavos: null,
      valorMaxCentavos: null,
      prioridade: 0,
    });

    const r = await service.criarRegra(U, { padrao: 'padaria', categoria: 'MERCADO' });

    expect(prisma.regraCategoria.create).toHaveBeenCalledWith({
      data: {
        userId: U,
        padrao: 'padaria',
        categoria: 'MERCADO',
        tipo: null,
        valorMinCentavos: null,
        valorMaxCentavos: null,
        prioridade: 0,
      },
    });
    expect(r).toEqual({
      id: 'r1',
      padrao: 'padaria',
      categoria: 'MERCADO',
      tipo: null,
      valorMinCentavos: null,
      valorMaxCentavos: null,
      prioridade: 0,
    });
  });

  it('CA-23: faixa com mínimo maior que o máximo dá 400 FAIXA_INVALIDA e nada é gravado', async () => {
    const { prisma, service } = montar();

    const erro = await service
      .criarRegra(U, {
        padrao: 'x',
        categoria: 'SALARIO',
        valorMinCentavos: 200,
        valorMaxCentavos: 100,
      })
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(BadRequestException);
    expect((erro as BadRequestException).getResponse()).toMatchObject({ code: 'FAIXA_INVALIDA' });
    expect(prisma.regraCategoria.create).not.toHaveBeenCalled();
  });

  describe('CA-24: o usuário edita a regra (PATCH) sem mexer em código', () => {
    const regraBanco = {
      id: 'r1',
      padrao: 'lucas farias leandro',
      categoria: 'SALARIO',
      tipo: 'CREDITO',
      valorMinCentavos: 80_000,
      valorMaxCentavos: 150_000,
      prioridade: 5,
    };

    it('ajusta só a faixa (o salário subiu) e preserva o resto', async () => {
      const { prisma, service } = montar();
      prisma.regraCategoria.findFirst.mockResolvedValue(regraBanco);
      prisma.regraCategoria.update.mockResolvedValue({ ...regraBanco, valorMaxCentavos: 300_000 });

      const r = await service.atualizarRegra(U, 'r1', { valorMaxCentavos: 300_000 });

      expect(prisma.regraCategoria.update).toHaveBeenCalledWith({
        where: { id: 'r1', userId: U },
        data: { valorMinCentavos: 80_000, valorMaxCentavos: 300_000 },
      });
      expect(r.valorMaxCentavos).toBe(300_000);
    });

    it('null remove a faixa e o tipo', async () => {
      const { prisma, service } = montar();
      prisma.regraCategoria.findFirst.mockResolvedValue(regraBanco);
      prisma.regraCategoria.update.mockResolvedValue({
        ...regraBanco,
        tipo: null,
        valorMinCentavos: null,
        valorMaxCentavos: null,
      });

      await service.atualizarRegra(U, 'r1', {
        tipo: null,
        valorMinCentavos: null,
        valorMaxCentavos: null,
      });

      expect(prisma.regraCategoria.update).toHaveBeenCalledWith({
        where: { id: 'r1', userId: U },
        data: { tipo: null, valorMinCentavos: null, valorMaxCentavos: null },
      });
    });

    it('rejeita faixa que ficaria invertida pela combinação com o que já existe', async () => {
      const { prisma, service } = montar();
      prisma.regraCategoria.findFirst.mockResolvedValue(regraBanco);

      await expect(service.atualizarRegra(U, 'r1', { valorMinCentavos: 200_000 })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.regraCategoria.update).not.toHaveBeenCalled();
    });

    it('regra inexistente dá 404 REGRA_NAO_ENCONTRADA', async () => {
      const { prisma, service } = montar();
      prisma.regraCategoria.findFirst.mockResolvedValue(null);

      const erro = await service.atualizarRegra(U, 'x', { prioridade: 1 }).catch((e: unknown) => e);

      expect(erro).toBeInstanceOf(NotFoundException);
      expect((erro as NotFoundException).getResponse()).toMatchObject({
        code: 'REGRA_NAO_ENCONTRADA',
      });
    });
  });

  it('CA-11: remover regra inexistente dá 404 REGRA_NAO_ENCONTRADA', async () => {
    const { prisma, service } = montar();
    prisma.regraCategoria.deleteMany.mockResolvedValue({ count: 0 });

    const erro = await service.removerRegra(U, 'x').catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(NotFoundException);
    expect((erro as NotFoundException).getResponse()).toMatchObject({
      code: 'REGRA_NAO_ENCONTRADA',
    });
  });

  it('CA-11: remover regra existente não lança', async () => {
    const { prisma, service } = montar();
    prisma.regraCategoria.deleteMany.mockResolvedValue({ count: 1 });

    await expect(service.removerRegra(U, 'r1')).resolves.toBeUndefined();
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

    const n = await service.categorizarPendentes(U);

    expect(n).toBe(3);
    expect(prisma.transacao.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { categoria: null, userId: U } }),
    );
    expect(prisma.transacao.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.transacao.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] }, userId: U },
      data: { categoria: 'PAGAMENTO_FATURA', origemCategoria: 'REGRA_PADRAO' },
    });
  });

  it('sem pendentes não consulta regras nem atualiza', async () => {
    const { prisma, service } = montar();

    await expect(service.categorizarPendentes(U)).resolves.toBe(0);
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

    const primeira = await service.recalcular(U);

    expect(prisma.transacao.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: U,
          OR: [{ origemCategoria: null }, { origemCategoria: { not: 'MANUAL' } }],
        },
      }),
    );
    expect(primeira).toEqual({ analisadas: 2, alteradas: 1 });
    expect(prisma.transacao.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['b'] }, userId: U },
      data: { categoria: 'MERCADO', origemCategoria: 'REGRA_USUARIO' },
    });

    prisma.transacao.findMany.mockResolvedValueOnce([
      { ...mudou, categoria: 'MERCADO', origemCategoria: 'REGRA_USUARIO' },
      igual,
    ]);
    prisma.transacao.updateMany.mockClear();
    await expect(service.recalcular(U)).resolves.toEqual({ analisadas: 2, alteradas: 0 });
    expect(prisma.transacao.updateMany).not.toHaveBeenCalled();
  });

  it('CA-14: categorizarUma reavalia por regra e grava a origem', async () => {
    const { prisma, service } = montar();
    prisma.transacao.findFirstOrThrow.mockResolvedValue(
      linha({
        id: 'a',
        categoriaPluggy: 'Pharmacy',
        categoria: 'LAZER',
        origemCategoria: 'MANUAL',
      }),
    );

    const r = await service.categorizarUma(U, 'a');

    expect(r).toEqual({ categoria: 'SAUDE', origemCategoria: 'REGRA_PADRAO' });
    expect(prisma.transacao.update).toHaveBeenCalledWith({
      where: { id: 'a', userId: U },
      data: { categoria: 'SAUDE', origemCategoria: 'REGRA_PADRAO' },
    });
  });
});
