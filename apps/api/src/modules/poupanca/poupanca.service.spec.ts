import { PrismaService } from '../../database/prisma.service';
import { PoupancaService } from './poupanca.service';

function montar() {
  const prisma = { transacao: { groupBy: jest.fn().mockResolvedValue([]) } };
  return { prisma, service: new PoupancaService(prisma as unknown as PrismaService) };
}

const grupo = (categoria: string | null, tipo: string, n: number, total: number) => ({
  categoria,
  tipo,
  _count: { _all: n },
  _sum: { valorCentavos: total },
});

describe('PoupancaService', () => {
  it('CA-10: consulta o intervalo [início do mês, início do próximo) em UTC, agrupando por categoria e tipo', async () => {
    const { prisma, service } = montar();

    await service.mes('2026-09');

    expect(prisma.transacao.groupBy).toHaveBeenCalledWith({
      by: ['categoria', 'tipo'],
      where: {
        data: { gte: new Date('2026-09-01T00:00:00Z'), lt: new Date('2026-10-01T00:00:00Z') },
      },
      _count: { _all: true },
      _sum: { valorCentavos: true },
    });
  });

  it('dezembro fecha em janeiro do ano seguinte', async () => {
    const { prisma, service } = montar();

    await service.mes('2026-12');

    expect(prisma.transacao.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          data: { gte: new Date('2026-12-01T00:00:00Z'), lt: new Date('2027-01-01T00:00:00Z') },
        },
      }),
    );
  });

  it('traduz os grupos do banco para o cálculo (soma nula vira 0)', async () => {
    const { prisma, service } = montar();
    prisma.transacao.groupBy.mockResolvedValue([
      grupo('SALARIO', 'CREDITO', 1, 1_000_000),
      grupo('MERCADO', 'DEBITO', 5, -250_000),
      grupo(null, 'DEBITO', 1, null as unknown as number),
    ]);

    const r = await service.mes('2026-09');

    expect(r).toMatchObject({
      receitasCentavos: 1_000_000,
      despesasCentavos: 250_000,
      poupancaCentavos: 750_000,
      taxaBasisPoints: 7500,
      transacoes: 7,
    });
  });

  it('CA-11: historico devolve do mais antigo ao mês corrente (e cruza o ano)', async () => {
    const { service } = montar();

    const tres = await service.historico(3, new Date('2026-10-15T12:00:00Z'));
    const virada = await service.historico(3, new Date('2026-01-10T12:00:00Z'));

    expect(tres.meses.map((m) => m.mes)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(virada.meses.map((m) => m.mes)).toEqual(['2025-11', '2025-12', '2026-01']);
  });

  it('CA-11: sem argumento são 6 meses', async () => {
    const { service } = montar();

    expect(
      (await service.historico(undefined, new Date('2026-10-15T00:00:00Z'))).meses,
    ).toHaveLength(6);
  });

  it('CA-12: o mês do histórico é idêntico ao de mes()', async () => {
    const { prisma, service } = montar();
    prisma.transacao.groupBy.mockResolvedValue([
      grupo('SALARIO', 'CREDITO', 1, 500_000),
      grupo('LAZER', 'DEBITO', 2, -100_000),
    ]);

    const direto = await service.mes('2026-09');
    const historico = await service.historico(2, new Date('2026-10-02T00:00:00Z'));

    expect(historico.meses[0]).toEqual(direto);
  });
});
