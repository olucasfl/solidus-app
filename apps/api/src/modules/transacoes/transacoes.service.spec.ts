import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CategorizacaoService } from '../categorizacao/categorizacao.service';
import { TransacoesService } from './transacoes.service';

const U = 'u1';

function montar() {
  const prisma = {
    transacao: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    },
  };
  const categorizacao = {
    categorizarUma: jest
      .fn()
      .mockResolvedValue({ categoria: 'SAUDE', origemCategoria: 'REGRA_PADRAO' }),
  };
  const service = new TransacoesService(
    prisma as unknown as PrismaService,
    categorizacao as unknown as CategorizacaoService,
  );
  return { prisma, categorizacao, service };
}

describe('TransacoesService.definirCategoria', () => {
  it('CA-12: categoria válida fixa MANUAL', async () => {
    const { prisma, service } = montar();
    prisma.transacao.findFirst.mockResolvedValue({ id: 't1' });

    await expect(service.definirCategoria(U, 't1', 'LAZER')).resolves.toEqual({
      id: 't1',
      categoria: 'LAZER',
      origemCategoria: 'MANUAL',
    });
    expect(prisma.transacao.update).toHaveBeenCalledWith({
      where: { id: 't1', userId: U },
      data: { categoria: 'LAZER', origemCategoria: 'MANUAL' },
    });
  });

  it('CA-12: transação inexistente dá 404 TRANSACAO_NAO_ENCONTRADA', async () => {
    const { prisma, service } = montar();
    prisma.transacao.findFirst.mockResolvedValue(null);

    const erro = await service.definirCategoria(U, 'x', 'LAZER').catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(NotFoundException);
    expect((erro as NotFoundException).getResponse()).toMatchObject({
      code: 'TRANSACAO_NAO_ENCONTRADA',
    });
    expect(prisma.transacao.update).not.toHaveBeenCalled();
  });

  it('CA-14: null solta a manual e devolve o resultado das regras', async () => {
    const { prisma, categorizacao, service } = montar();
    prisma.transacao.findFirst.mockResolvedValue({ id: 't1' });

    await expect(service.definirCategoria(U, 't1', null)).resolves.toEqual({
      id: 't1',
      categoria: 'SAUDE',
      origemCategoria: 'REGRA_PADRAO',
    });
    expect(categorizacao.categorizarUma).toHaveBeenCalledWith(U, 't1');
  });
});

describe('TransacoesService.listar', () => {
  it('CA-16: filtra por mês (UTC, [início, próximo mês)) e categoria, pagina e ordena por data desc', async () => {
    const { prisma, service } = montar();
    prisma.transacao.count.mockResolvedValue(5);
    prisma.transacao.findMany.mockResolvedValue([
      {
        id: 't1',
        contaId: 'c1',
        data: new Date('2026-09-10T00:00:00Z'),
        descricao: 'Mercado',
        valorCentavos: -1000,
        tipo: 'DEBITO',
        status: 'EFETIVADA',
        moeda: 'BRL',
        categoria: 'MERCADO',
        origemCategoria: 'REGRA_PADRAO',
      },
    ]);

    const r = await service.listar(U, {
      mes: '2026-09',
      categoria: 'MERCADO',
      limite: 2,
      pagina: 3,
    });

    const where = {
      userId: U,
      data: { gte: new Date('2026-09-01T00:00:00Z'), lt: new Date('2026-10-01T00:00:00Z') },
      categoria: 'MERCADO',
    };
    expect(prisma.transacao.count).toHaveBeenCalledWith({ where });
    expect(prisma.transacao.findMany).toHaveBeenCalledWith({
      where,
      orderBy: [{ data: 'desc' }, { id: 'asc' }],
      skip: 4,
      take: 2,
    });
    expect(r).toMatchObject({ total: 5, pagina: 3, limite: 2 });
    expect(r.itens[0]).toMatchObject({ id: 't1', data: '2026-09-10T00:00:00.000Z' });
  });

  it('dezembro fecha em janeiro do ano seguinte e os defaults são pagina 1 / limite 50', async () => {
    const { prisma, service } = montar();

    const r = await service.listar(U, { mes: '2026-12' });

    expect(prisma.transacao.count).toHaveBeenCalledWith({
      where: {
        userId: U,
        data: { gte: new Date('2026-12-01T00:00:00Z'), lt: new Date('2027-01-01T00:00:00Z') },
      },
    });
    expect(r).toMatchObject({ pagina: 1, limite: 50 });
  });
});
