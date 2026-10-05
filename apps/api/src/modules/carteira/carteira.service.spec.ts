import * as relogio from '../../common/relogio';
import { PrismaService } from '../../database/prisma.service';
import { CarteiraService } from './carteira.service';
import { ImpostosService } from './impostos.service';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function caixinha(p: Record<string, unknown>) {
  return {
    id: 'c1',
    nome: 'Turbo',
    percentualCdiBp: 10_000,
    reservaDeGastos: false,
    ativa: true,
    movimentos: [],
    ...p,
  };
}
const saldo = (data: string, valorCentavos: number, p: Record<string, unknown> = {}) => ({
  tipo: 'SALDO',
  data: d(data),
  valorCentavos,
  dataOrigem: null,
  ...p,
});

function montar(faixas: { IOF: unknown[]; IR: unknown[] } = { IOF: [], IR: [] }) {
  const prisma = {
    caixinha: { findMany: jest.fn().mockResolvedValue([]) },
    cdiDia: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const impostos = {
    faixas: jest.fn((tipo: 'IOF' | 'IR') => Promise.resolve(faixas[tipo])),
  };
  const service = new CarteiraService(
    prisma as unknown as PrismaService,
    impostos as unknown as ImpostosService,
  );
  return { prisma, service };
}

beforeEach(() => {
  jest.spyOn(relogio, 'hojeUtc').mockReturnValue('2026-10-05');
});
afterEach(() => jest.restoreAllMocks());

describe('CarteiraService.consultar', () => {
  it('sem Caixinhas: totais zerados e nenhum aviso', async () => {
    const { service } = montar();

    await expect(service.consultar()).resolves.toEqual({
      data: '2026-10-05',
      caixinhas: [],
      totais: { patrimonioCentavos: 0, investidoCentavos: 0, disponivelParaGastarCentavos: 0 },
      avisos: [],
    });
  });

  it('calcula cada Caixinha com o CDI gravado e separa investido de reserva de gastos', async () => {
    const { prisma, service } = montar();
    prisma.caixinha.findMany.mockResolvedValue([
      caixinha({
        id: 'turbo',
        percentualCdiBp: 11_500,
        movimentos: [saldo('2026-10-04', 10_000_000)],
      }),
      caixinha({
        id: 'gastos',
        nome: 'Gastos',
        percentualCdiBp: 0,
        reservaDeGastos: true,
        movimentos: [saldo('2026-10-04', 30_000)],
      }),
    ]);
    prisma.cdiDia.findMany.mockResolvedValue([{ data: d('2026-10-05'), taxaE8: 55_131 }]);

    const r = await service.consultar();

    // 100.000,00 x (1 + 0,00055131 x 1,15) = 100.063,40… → trunca para 100.063,40
    const turbo = r.caixinhas.find((c) => c.id === 'turbo')!;
    expect(turbo.saldoBrutoEstimadoCentavos).toBe(10_006_340);
    expect(turbo.rendimentoBrutoCentavos).toBe(6_340);
    expect(r.caixinhas.find((c) => c.id === 'gastos')!.saldoBrutoEstimadoCentavos).toBe(30_000);
    expect(r.totais).toEqual({
      patrimonioCentavos: 10_036_340,
      investidoCentavos: 10_006_340,
      disponivelParaGastarCentavos: 30_000,
    });
  });

  it('passa as faixas de IR/IOF ao cálculo; sem elas, avisa e deixa o líquido nulo', async () => {
    const semTabela = montar();
    semTabela.prisma.caixinha.findMany.mockResolvedValue([
      caixinha({ movimentos: [saldo('2026-10-04', 100_000)] }),
    ]);
    const r1 = await semTabela.service.consultar();
    expect(r1.caixinhas[0]!.saldoLiquidoEstimadoCentavos).toBeNull();
    expect(r1.avisos).toContain('IMPOSTO_NAO_CONFIGURADO');

    const comTabela = montar({
      IOF: [{ ateDias: null, aliquotaBp: 0 }],
      IR: [{ ateDias: null, aliquotaBp: 1_500 }],
    });
    comTabela.prisma.caixinha.findMany.mockResolvedValue([
      caixinha({ movimentos: [saldo('2026-10-04', 100_000)] }),
    ]);
    comTabela.prisma.cdiDia.findMany.mockResolvedValue([
      { data: d('2026-10-05'), taxaE8: 1_000_000 },
    ]);
    const r2 = await comTabela.service.consultar();
    expect(r2.caixinhas[0]!.impostos).toEqual({ iofCentavos: 0, irCentavos: 150 });
    expect(r2.avisos).not.toContain('IMPOSTO_NAO_CONFIGURADO');
  });

  it('aviso por Caixinha sem saldo informado; inativa não entra nos totais nem nos avisos', async () => {
    const { prisma, service } = montar();
    prisma.caixinha.findMany.mockResolvedValue([
      caixinha({ id: 'nova', movimentos: [] }),
      caixinha({ id: 'velha', ativa: false, movimentos: [saldo('2026-10-04', 500_000)] }),
    ]);

    const r = await service.consultar();

    expect(r.caixinhas.find((c) => c.id === 'nova')!.avisos).toEqual(['SEM_SALDO_INFORMADO']);
    expect(r.avisos).toContain('SEM_SALDO_INFORMADO');
    expect(r.totais.patrimonioCentavos).toBe(0);
  });

  it('consulta numa data passada ignora saldo posterior e CDI posterior', async () => {
    const { prisma, service } = montar();
    prisma.caixinha.findMany.mockResolvedValue([
      caixinha({ movimentos: [saldo('2026-09-01', 100_000), saldo('2026-10-01', 900_000)] }),
    ]);

    const r = await service.consultar('2026-09-15');

    expect(r.data).toBe('2026-09-15');
    expect(r.caixinhas[0]!.saldoInformado).toEqual({ data: '2026-09-01', centavos: 100_000 });
    expect(prisma.cdiDia.findMany).toHaveBeenCalledWith({
      where: { data: { lte: d('2026-09-15') } },
    });
  });

  it('rejeita data futura e data inexistente', async () => {
    const { service } = montar();

    await expect(service.consultar('2026-10-06')).rejects.toMatchObject({
      response: { code: 'DATA_FUTURA' },
    });
    await expect(service.consultar('2026-02-30')).rejects.toMatchObject({
      response: { code: 'DATA_INVALIDA' },
    });
  });
});
