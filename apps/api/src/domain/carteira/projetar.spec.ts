import { type DataIso } from './datas';
import {
  type FaixaImposto,
  type Movimento,
  projetarCaixinha,
  type ParametrosProjecao,
} from './projetar';

const SEM_IMPOSTO: Pick<ParametrosProjecao, 'iof' | 'ir'> = { iof: [], ir: [] };

function saldo(data: DataIso, valorCentavos: number, dataOrigem?: DataIso): Movimento {
  return { tipo: 'SALDO', data, valorCentavos, dataOrigem };
}
function aporte(data: DataIso, valorCentavos: number): Movimento {
  return { tipo: 'APORTE', data, valorCentavos };
}
function resgate(data: DataIso, valorCentavos: number): Movimento {
  return { tipo: 'RESGATE', data, valorCentavos };
}

function proj(p: Partial<ParametrosProjecao> & Pick<ParametrosProjecao, 'movimentos' | 'ate'>) {
  return projetarCaixinha({
    percentualCdiBp: 10_000,
    cdi: new Map(),
    ...SEM_IMPOSTO,
    ...p,
  });
}

// 0,1% ao dia = fração 0,001 = 100000 (x10^8); com 100% do CDI o fator do dia é exatamente 1,001.
const UM_MIL_E_UM = 100_000;

describe('projetarCaixinha — rendimento bruto', () => {
  it('CA-01: R$ 1.000,00 com CDI 0,055131% a 100% rende R$ 0,55131 e mostra truncado (R$ 1.000,55)', () => {
    const r = proj({
      movimentos: [saldo('2026-09-01', 100_000)],
      cdi: new Map([['2026-09-02', 55_131]]),
      ate: '2026-09-02',
    });

    expect(r.saldoBrutoCentavos).toBe(100_055);
    expect(r.rendimentoBrutoCentavos).toBe(55);
    expect(r.saldoInformado).toEqual({ data: '2026-09-01', centavos: 100_000 });
  });

  it('CA-02: fim de semana e feriado (sem CDI) não rendem', () => {
    // sexta 02/01 é o saldo; sábado e domingo sem CDI; segunda 05/01 tem CDI.
    const r = proj({
      movimentos: [saldo('2026-01-02', 100_000)],
      cdi: new Map([['2026-01-05', UM_MIL_E_UM]]),
      ate: '2026-01-05',
    });

    expect(r.saldoBrutoCentavos).toBe(100_100);
  });

  it('CA-03: 115% do CDI rende proporcionalmente mais que 100%', () => {
    const base = {
      movimentos: [saldo('2026-09-01', 10_000_000)],
      cdi: new Map([['2026-09-02', 55_131]]),
      ate: '2026-09-02',
    };

    expect(proj({ ...base, percentualCdiBp: 10_000 }).rendimentoBrutoCentavos).toBe(5_513);
    expect(proj({ ...base, percentualCdiBp: 11_500 }).rendimentoBrutoCentavos).toBe(6_340);
    expect(proj({ ...base, percentualCdiBp: 0 }).rendimentoBrutoCentavos).toBe(0);
  });

  it('CA-04: 30 dias saem do produtório exato, sem arredondar por dia', () => {
    const cdi = new Map<DataIso, number>();
    for (let dia = 2; dia <= 31; dia += 1) {
      cdi.set(`2026-01-${String(dia).padStart(2, '0')}`, 55_131 + dia);
    }
    const inicial = 1_000_000;

    // Oráculo independente: fração exata (nada truncado no meio do caminho).
    let numerador = BigInt(inicial);
    let denominador = 1n;
    for (const taxa of cdi.values()) {
      numerador *= 10n ** 12n + BigInt(taxa) * 10_000n;
      denominador *= 10n ** 12n;
    }
    const exato = Number(numerador / denominador);

    // Arredondando ao centavo todo dia (o que o Nubank NÃO faz), o resultado diverge.
    let diario = inicial;
    for (const taxa of cdi.values()) {
      diario = Math.round(diario * (1 + (taxa / 1e8) * 1));
    }

    const r = proj({
      movimentos: [saldo('2026-01-01', inicial)],
      cdi,
      ate: '2026-01-31',
    });

    expect(r.saldoBrutoCentavos).toBe(exato);
    expect(r.saldoBrutoCentavos).not.toBe(diario);
  });
});

describe('projetarCaixinha — movimentos', () => {
  const cdi = new Map<DataIso, number>([
    ['2026-01-02', UM_MIL_E_UM],
    ['2026-01-05', UM_MIL_E_UM],
  ]);

  it('CA-05: aporte só começa a render no dia seguinte', () => {
    const base = { movimentos: [saldo('2026-01-01', 100_000), aporte('2026-01-02', 50_000)], cdi };

    // no próprio dia: o saldo antigo rendeu (100.100) e o aporte entra inteiro, sem render
    expect(proj({ ...base, ate: '2026-01-02' }).saldoBrutoCentavos).toBe(150_100);
    // dois dias de CDI depois: 100.100 x 1,001 + 50.000 x 1,001 = 150.250,1 → trunca
    expect(proj({ ...base, ate: '2026-01-05' }).saldoBrutoCentavos).toBe(150_250);
  });

  it('CA-05: resgate no dia ainda leva o rendimento do dia e só depois reduz', () => {
    const r = proj({
      movimentos: [saldo('2026-01-01', 100_000), resgate('2026-01-02', 40_000)],
      cdi,
      ate: '2026-01-02',
    });

    expect(r.saldoBrutoCentavos).toBe(60_100);
  });

  it('CA-06: vale o SALDO mais recente; tudo antes dele é ignorado', () => {
    const r = proj({
      movimentos: [
        saldo('2026-01-01', 100_000),
        aporte('2026-01-02', 7_777),
        saldo('2026-01-03', 500_000),
      ],
      cdi,
      ate: '2026-01-03',
    });

    expect(r.saldoBrutoCentavos).toBe(500_000);
    expect(r.saldoInformado).toEqual({ data: '2026-01-03', centavos: 500_000 });
  });

  it('movimento no mesmo dia do SALDO já está dentro dele (não é contado de novo)', () => {
    const r = proj({
      movimentos: [saldo('2026-01-01', 100_000), aporte('2026-01-01', 50_000)],
      ate: '2026-01-01',
    });

    expect(r.saldoBrutoCentavos).toBe(100_000);
  });

  it('SALDO posterior à data pedida não conta (a consulta é "até")', () => {
    const r = proj({
      movimentos: [saldo('2026-01-01', 100_000), saldo('2026-02-01', 999_999)],
      cdi,
      ate: '2026-01-02',
    });

    expect(r.saldoInformado?.data).toBe('2026-01-01');
    expect(r.saldoBrutoCentavos).toBe(100_100);
  });

  it('CA-07: resgate consome o lote mais antigo primeiro (FIFO) e depois o seguinte', () => {
    const r = proj({
      movimentos: [
        saldo('2026-01-01', 100_000),
        aporte('2026-01-02', 50_000),
        resgate('2026-01-03', 120_000),
      ],
      cdi: new Map([['2026-01-02', UM_MIL_E_UM]]),
      ate: '2026-01-03',
    });

    // lote 1 = 100.100 inteiro; sobram 19.900 a tirar do aporte (50.000): ficam 30.100
    expect(r.saldoBrutoCentavos).toBe(30_100);
    expect(r.rendimentoBrutoCentavos).toBe(0);
  });

  it('CA-07: resgate parcial de um lote leva rendimento e principal na mesma proporção', () => {
    const r = proj({
      movimentos: [saldo('2026-01-01', 100_000), resgate('2026-01-02', 50_050)],
      cdi: new Map([['2026-01-02', UM_MIL_E_UM]]),
      ate: '2026-01-02',
    });

    expect(r.saldoBrutoCentavos).toBe(50_050);
    expect(r.rendimentoBrutoCentavos).toBe(50);
  });

  it('CA-20: resgate maior que o saldo é limitado ao saldo e avisa, nunca fica negativo', () => {
    const r = proj({
      movimentos: [saldo('2026-01-01', 10_000), resgate('2026-01-02', 99_999)],
      ate: '2026-01-02',
    });

    expect(r.saldoBrutoCentavos).toBe(0);
    expect(r.avisos).toContain('RESGATE_ACIMA_DO_SALDO');
  });
});

describe('projetarCaixinha — líquido (IOF e IR por lote)', () => {
  // Um dia de CDI de 1%/dia (1000000 x10^8) a 100%: R$ 10.000,00 → rende exatamente R$ 100,00.
  const IOF: FaixaImposto[] = [
    { ateDias: 10, aliquotaBp: 6_600 },
    { ateDias: null, aliquotaBp: 0 },
  ];
  const IR: FaixaImposto[] = [
    { ateDias: 180, aliquotaBp: 2_250 },
    { ateDias: 360, aliquotaBp: 2_000 },
    { ateDias: 720, aliquotaBp: 1_750 },
    { ateDias: null, aliquotaBp: 1_500 },
  ];
  const um = (origem: DataIso) =>
    proj({
      movimentos: [saldo('2026-06-09', 1_000_000, origem)],
      cdi: new Map([['2026-06-10', 1_000_000]]),
      ate: '2026-06-10',
      iof: IOF,
      ir: IR,
    });

  it('CA-08: lote de 10 dias paga IOF sobre o rendimento e IR sobre o que sobra', () => {
    const r = um('2026-05-31'); // idade = 10 dias

    expect(r.rendimentoBrutoCentavos).toBe(10_000);
    expect(r.impostos).toEqual({ iofCentavos: 6_600, irCentavos: 765 }); // (10000−6600) x 22,5%
    expect(r.rendimentoLiquidoCentavos).toBe(2_635);
    expect(r.saldoLiquidoCentavos).toBe(1_002_635);
  });

  it('CA-08: lote com mais de 720 dias paga 15% de IR e 0% de IOF', () => {
    const r = um('2024-01-01');

    expect(r.impostos).toEqual({ iofCentavos: 0, irCentavos: 1_500 });
    expect(r.rendimentoLiquidoCentavos).toBe(8_500);
  });

  it('CA-10: a dataOrigem informada no SALDO define a faixa do IR (400 dias → 17,5%)', () => {
    const r = um('2025-05-06'); // 400 dias antes de 2026-06-10

    expect(r.impostos).toEqual({ iofCentavos: 0, irCentavos: 1_750 });
  });

  it('as faixas valem nas bordas (idade igual ao limite fica na faixa de baixo)', () => {
    expect(um('2025-12-12').impostos?.irCentavos).toBe(2_250); // 180 dias
    expect(um('2025-12-11').impostos?.irCentavos).toBe(2_000); // 181 dias
  });

  it('CA-09: tabelas vazias → líquido nulo e aviso, sem derrubar o bruto', () => {
    const r = proj({
      movimentos: [saldo('2026-06-09', 1_000_000)],
      cdi: new Map([['2026-06-10', 1_000_000]]),
      ate: '2026-06-10',
    });

    expect(r.saldoBrutoCentavos).toBe(1_010_000);
    expect(r.impostos).toBeNull();
    expect(r.saldoLiquidoCentavos).toBeNull();
    expect(r.rendimentoLiquidoCentavos).toBeNull();
    expect(r.avisos).toContain('IMPOSTO_NAO_CONFIGURADO');
  });

  it('cada lote paga pela própria idade (aporte novo + saldo antigo)', () => {
    const r = proj({
      movimentos: [saldo('2024-01-01', 1_000_000), aporte('2026-06-09', 1_000_000)],
      cdi: new Map([['2026-06-10', 1_000_000]]),
      ate: '2026-06-10',
      iof: IOF,
      ir: IR,
    });

    // saldo antigo (>720d): rende 10.000 → IR 15% = 1.500, IOF 0.
    // aporte de ontem (idade 1 dia) também rendeu 10.000 hoje: IOF 66% = 6.600; IR 22,5% de 3.400 = 765.
    expect(r.impostos).toEqual({ iofCentavos: 6_600, irCentavos: 2_265 });
  });
});

describe('projetarCaixinha — avisos', () => {
  it('sem SALDO informado', () => {
    const r = proj({ movimentos: [aporte('2026-01-02', 5_000)], ate: '2026-01-05' });

    expect(r).toMatchObject({
      saldoInformado: null,
      saldoBrutoCentavos: 0,
      saldoLiquidoCentavos: null,
      avisos: ['SEM_SALDO_INFORMADO'],
    });
  });

  it('CA-11: CDI defasado quando o último CDI tem mais de 4 dias', () => {
    const base = { movimentos: [saldo('2026-01-01', 100_000)], ate: '2026-01-11' };

    expect(proj({ ...base, cdi: new Map([['2026-01-05', UM_MIL_E_UM]]) }).avisos).toContain(
      'CDI_DEFASADO',
    );
    expect(proj({ ...base, cdi: new Map([['2026-01-07', UM_MIL_E_UM]]) }).avisos).not.toContain(
      'CDI_DEFASADO',
    );
    expect(proj(base).avisos).toContain('CDI_DEFASADO');
  });

  it('saldo informado hoje não precisa de CDI (nada a render ainda)', () => {
    const r = proj({ movimentos: [saldo('2026-01-11', 100_000)], ate: '2026-01-11' });

    expect(r.avisos).not.toContain('CDI_DEFASADO');
  });
});

describe('projetarCaixinha — propriedade', () => {
  it('CA-20: 200 entradas aleatórias → saídas sempre inteiras, não negativas e líquido ≤ bruto', () => {
    let semente = 7;
    const rnd = (): number => {
      semente = (semente * 1_103_515_245 + 12_345) % 2_147_483_648;
      return semente / 2_147_483_648;
    };
    const dia = (n: number): DataIso =>
      new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);
    const iof: FaixaImposto[] = [
      { ateDias: 29, aliquotaBp: 5_000 },
      { ateDias: null, aliquotaBp: 0 },
    ];
    const ir: FaixaImposto[] = [
      { ateDias: 180, aliquotaBp: 2_250 },
      { ateDias: null, aliquotaBp: 1_500 },
    ];

    for (let i = 0; i < 200; i += 1) {
      const movimentos: Movimento[] = [saldo(dia(0), Math.floor(rnd() * 5_000_000))];
      for (let m = 0; m < Math.floor(rnd() * 6); m += 1) {
        const tipo = rnd() < 0.5 ? aporte : resgate;
        movimentos.push(tipo(dia(1 + Math.floor(rnd() * 60)), 1 + Math.floor(rnd() * 3_000_000)));
      }
      movimentos.sort((a, b) => a.data.localeCompare(b.data));
      const cdi = new Map<DataIso, number>();
      for (let d = 1; d <= 70; d += 1) {
        if (d % 7 !== 0 && d % 7 !== 6) cdi.set(dia(d), 30_000 + Math.floor(rnd() * 40_000));
      }

      const r = proj({
        movimentos,
        cdi,
        ate: dia(70),
        percentualCdiBp: [0, 10_000, 11_500][Math.floor(rnd() * 3)]!,
        iof,
        ir,
      });

      for (const n of [r.saldoBrutoCentavos, r.rendimentoBrutoCentavos, r.saldoLiquidoCentavos]) {
        expect(Number.isInteger(n)).toBe(true);
        expect(n!).toBeGreaterThanOrEqual(0);
      }
      expect(r.saldoLiquidoCentavos!).toBeLessThanOrEqual(r.saldoBrutoCentavos);
    }
  });
});
