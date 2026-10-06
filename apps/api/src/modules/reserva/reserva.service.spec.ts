import { BadRequestException } from '@nestjs/common';
import type {
  Carteira,
  CaixinhaNaCarteira,
  HistoricoPoupancaResponse,
  PoupancaMes,
} from '@solidus/shared';
import { PrismaService } from '../../database/prisma.service';
import { type CarteiraService } from '../carteira/carteira.service';
import { type PoupancaService } from '../poupanca/poupanca.service';
import { CONFIGURACAO_PADRAO, ReservaService } from './reserva.service';

// Dados 100% sintéticos (RULES §8).
const U = 'user-1';
const AGORA = new Date('2026-10-06T12:00:00.000Z');

/** Um mês da poupança com só o que a reserva lê. */
function mesPoupanca(mes: string, despesas: number, abatimento = 0, transacoes = 10): PoupancaMes {
  return {
    mes,
    receitasCentavos: 0,
    despesasCentavos: despesas,
    poupancaCentavos: 0,
    taxaBasisPoints: null,
    transacoes,
    neutras: { quantidade: 0 },
    indefinidas: { quantidade: 0, entradasCentavos: 0, saidasCentavos: 0 },
    pixPessoas: {
      quantidade: 0,
      entradasCentavos: 0,
      saidasCentavos: 0,
      liquidoCentavos: 0,
      abatimentoCentavos: abatimento,
    },
    porCategoria: [],
    avisos: [],
  };
}

function cx(parcial: Partial<CaixinhaNaCarteira> = {}): CaixinhaNaCarteira {
  return {
    id: 'cx-1',
    nome: 'Turbo',
    percentualCdiBp: 11_500,
    reservaDeGastos: false,
    reservaEmergencia: true,
    ativa: true,
    saldoInformado: null,
    saldoBrutoEstimadoCentavos: 110_000,
    rendimentoBrutoCentavos: 0,
    impostos: null,
    saldoLiquidoEstimadoCentavos: 100_000,
    rendimentoLiquidoCentavos: 0,
    avisos: [],
    ...parcial,
  };
}

function montar() {
  const prisma = {
    configuracaoReserva: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
    },
  };
  const poupanca = {
    // 7 meses: 6 fechados + o corrente (último), como o `historico(userId, 7)` devolve
    historico: jest.fn().mockResolvedValue({
      meses: [
        mesPoupanca('2026-03', 100_000),
        mesPoupanca('2026-04', 100_000),
        mesPoupanca('2026-05', 100_000),
        mesPoupanca('2026-06', 100_000),
        mesPoupanca('2026-07', 100_000),
        mesPoupanca('2026-08', 100_000),
        mesPoupanca('2026-09', 100_000),
        mesPoupanca('2026-10', 9_999_999), // MÊS CORRENTE: não pode entrar
      ],
    } satisfies HistoricoPoupancaResponse),
  };
  const carteira = {
    consultar: jest.fn().mockResolvedValue({
      data: '2026-10-06',
      caixinhas: [cx()],
      totais: { patrimonioCentavos: 0, investidoCentavos: 0, disponivelParaGastarCentavos: 0 },
      avisos: [],
    } satisfies Carteira),
  };
  const service = new ReservaService(
    prisma as unknown as PrismaService,
    poupanca as unknown as PoupancaService,
    carteira as unknown as CarteiraService,
  );
  return { prisma, poupanca, carteira, service };
}

describe('ReservaService.obter', () => {
  it('CA-02: pede janela + 1 meses e DESCARTA o corrente (só meses fechados entram na média)', async () => {
    const { prisma, poupanca, service } = montar();
    prisma.configuracaoReserva.findUnique.mockResolvedValue({
      userId: U,
      meses: 6,
      base: 'BRUTA',
      janelaMeses: 2,
    });
    poupanca.historico.mockResolvedValue({
      meses: [
        mesPoupanca('2026-08', 100_000),
        mesPoupanca('2026-09', 100_000),
        mesPoupanca('2026-10', 9_999_999), // o mês corrente, incompleto
      ],
    });

    const r = await service.obter(U, AGORA);

    expect(poupanca.historico).toHaveBeenCalledWith(U, 3, AGORA);
    expect(r.gasto.meses.map((m) => m.mes)).toEqual(['2026-08', '2026-09']);
    expect(r.gasto.mediaMensalBrutaCentavos).toBe(100_000);
  });

  it('CA-03: bruto = despesa + abatimento do Pix; líquido = despesa; a base padrão BRUTA manda na meta', async () => {
    const { poupanca, service } = montar();
    poupanca.historico.mockResolvedValue({
      meses: [
        mesPoupanca('2026-04', 100_000, 200_000),
        mesPoupanca('2026-05', 100_000, 200_000),
        mesPoupanca('2026-06', 100_000, 200_000),
        mesPoupanca('2026-07', 100_000, 200_000),
        mesPoupanca('2026-08', 100_000, 200_000),
        mesPoupanca('2026-09', 100_000, 200_000),
        mesPoupanca('2026-10', 1, 0),
      ],
    });

    const r = await service.obter(U, AGORA);

    expect(r.gasto.meses[0]).toEqual({
      mes: '2026-04',
      brutoCentavos: 300_000,
      liquidoCentavos: 100_000,
    });
    expect(r.gasto.mediaMensalBrutaCentavos).toBe(300_000);
    expect(r.gasto.mediaMensalLiquidaCentavos).toBe(100_000);
    expect(r.gasto.base).toBe('BRUTA');
    expect(r.gasto.mediaMensalCentavos).toBe(300_000);
    expect(r.metaCentavos).toBe(1_800_000);
  });

  it('CA-03: com a base LIQUIDA configurada, a meta usa a média líquida', async () => {
    const { prisma, service } = montar();
    prisma.configuracaoReserva.findUnique.mockResolvedValue({
      userId: U,
      meses: 6,
      base: 'LIQUIDA',
      janelaMeses: 6,
    });

    const r = await service.obter(U, AGORA);

    expect(r.gasto.base).toBe('LIQUIDA');
    expect(r.configuracao.base).toBe('LIQUIDA');
  });

  it('CA-07: só entram Caixinhas ATIVAS e MARCADAS; a saldo vem do líquido estimado', async () => {
    const { carteira, service } = montar();
    carteira.consultar.mockResolvedValue({
      data: '2026-10-06',
      caixinhas: [
        cx({ id: 'a', nome: 'A', saldoLiquidoEstimadoCentavos: 250_000 }),
        cx({ id: 'b', nome: 'B', saldoLiquidoEstimadoCentavos: 80_000 }),
        cx({ id: 'nao-marcada', reservaEmergencia: false, saldoLiquidoEstimadoCentavos: 999_999 }),
        cx({ id: 'inativa', ativa: false, saldoLiquidoEstimadoCentavos: 888_888 }),
      ],
      totais: { patrimonioCentavos: 0, investidoCentavos: 0, disponivelParaGastarCentavos: 0 },
      avisos: [],
    });

    const r = await service.obter(U, AGORA);

    expect(r.reserva.saldoCentavos).toBe(330_000);
    expect(r.reserva.caixinhas.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('CA-09: líquido nulo (imposto não configurado) → usa o bruto da Caixinha e avisa', async () => {
    const { carteira, service } = montar();
    carteira.consultar.mockResolvedValue({
      data: '2026-10-06',
      caixinhas: [cx({ saldoLiquidoEstimadoCentavos: null, saldoBrutoEstimadoCentavos: 120_000 })],
      totais: { patrimonioCentavos: 0, investidoCentavos: 0, disponivelParaGastarCentavos: 0 },
      avisos: [],
    });

    const r = await service.obter(U, AGORA);

    expect(r.reserva.saldoCentavos).toBe(120_000);
    expect(r.reserva.caixinhas[0]!.baseDoSaldo).toBe('BRUTO_ESTIMADO');
    expect(r.avisos).toContain('IMPOSTO_NAO_CONFIGURADO');
  });

  it('CA-10: nenhuma Caixinha marcada → saldo 0 e NENHUMA_CAIXINHA_MARCADA', async () => {
    const { carteira, service } = montar();
    carteira.consultar.mockResolvedValue({
      data: '2026-10-06',
      caixinhas: [cx({ reservaEmergencia: false })],
      totais: { patrimonioCentavos: 0, investidoCentavos: 0, disponivelParaGastarCentavos: 0 },
      avisos: [],
    });

    const r = await service.obter(U, AGORA);

    expect(r.reserva.saldoCentavos).toBe(0);
    expect(r.avisos).toContain('NENHUMA_CAIXINHA_MARCADA');
    expect(r.coberturaMesesCentesimos).toBe(0);
  });

  it('CA-11: cobertura, falta e atingida (saldo 450.000, média 100.000, 6 meses)', async () => {
    const { carteira, service } = montar();
    carteira.consultar.mockResolvedValue({
      data: '2026-10-06',
      caixinhas: [cx({ saldoLiquidoEstimadoCentavos: 450_000 })],
      totais: { patrimonioCentavos: 0, investidoCentavos: 0, disponivelParaGastarCentavos: 0 },
      avisos: [],
    });

    const r = await service.obter(U, AGORA);

    expect(r.metaCentavos).toBe(600_000);
    expect(r.coberturaMesesCentesimos).toBe(450);
    expect(r.faltaCentavos).toBe(150_000);
    expect(r.atingida).toBe(false);
    expect(r.data).toBe('2026-10-06');
  });

  it('sem registro de configuração, valem os padrões (6 meses, BRUTA, janela 6)', async () => {
    const { service } = montar();

    expect((await service.obter(U, AGORA)).configuracao).toEqual(CONFIGURACAO_PADRAO);
    expect(CONFIGURACAO_PADRAO).toEqual({ meses: 6, base: 'BRUTA', janelaMeses: 6 });
  });

  it('CA-15: lê a configuração e consulta a carteira só do usuário da sessão', async () => {
    const { prisma, carteira, poupanca, service } = montar();

    await service.obter('user-b', AGORA);

    expect(prisma.configuracaoReserva.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-b' },
    });
    expect(carteira.consultar).toHaveBeenCalledWith('user-b');
    expect(poupanca.historico.mock.calls[0]![0]).toBe('user-b');
  });

  it('CA-05: nenhuma despesa na janela → SEM_GASTOS_NA_JANELA e meta 0', async () => {
    const { poupanca, service } = montar();
    poupanca.historico.mockResolvedValue({
      meses: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map(
        (m) => mesPoupanca(m, 0, 0, 5),
      ),
    });

    const r = await service.obter(U, AGORA);

    expect(r.avisos).toContain('SEM_GASTOS_NA_JANELA');
    expect(r.metaCentavos).toBe(0);
    expect(r.coberturaMesesCentesimos).toBeNull();
  });
});

describe('ReservaService.atualizarConfiguracao', () => {
  it('CA-12: cria o registro na primeira vez, com só os campos enviados', async () => {
    const { prisma, service } = montar();
    prisma.configuracaoReserva.upsert.mockResolvedValue({
      meses: 3,
      base: 'BRUTA',
      janelaMeses: 6,
    });

    const r = await service.atualizarConfiguracao(U, { meses: 3 });

    expect(prisma.configuracaoReserva.upsert).toHaveBeenCalledWith({
      where: { userId: U },
      create: { userId: U, meses: 3 },
      update: { meses: 3 },
    });
    expect(r).toEqual({ meses: 3, base: 'BRUTA', janelaMeses: 6 });
  });

  it('é parcial: base e janelaMeses juntos, sem tocar em meses', async () => {
    const { prisma, service } = montar();
    prisma.configuracaoReserva.upsert.mockResolvedValue({
      meses: 6,
      base: 'LIQUIDA',
      janelaMeses: 12,
    });

    await service.atualizarConfiguracao(U, { base: 'LIQUIDA', janelaMeses: 12 });

    expect(prisma.configuracaoReserva.upsert.mock.calls[0]![0].update).toEqual({
      base: 'LIQUIDA',
      janelaMeses: 12,
    });
  });

  it('CA-12: corpo sem nenhum campo → 400 CONFIGURACAO_VAZIA e nada é gravado', async () => {
    const { prisma, service } = montar();

    await expect(service.atualizarConfiguracao(U, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.configuracaoReserva.upsert).not.toHaveBeenCalled();
  });

  it('grava sempre com o userId da sessão', async () => {
    const { prisma, service } = montar();
    prisma.configuracaoReserva.upsert.mockResolvedValue({
      meses: 6,
      base: 'BRUTA',
      janelaMeses: 6,
    });

    await service.atualizarConfiguracao('user-b', { meses: 12 });

    expect(prisma.configuracaoReserva.upsert.mock.calls[0]![0].where).toEqual({ userId: 'user-b' });
  });
});
