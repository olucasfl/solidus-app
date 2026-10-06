import type { ConfiguracaoReserva } from '@solidus/shared';
import {
  calcularReserva,
  mediaParaCima,
  mesesComDados,
  type CaixinhaMarcada,
  type MesDaJanela,
} from './calcular-reserva';

// Dados 100% sintéticos (RULES §8): nenhum número do spike.
const CONFIG: ConfiguracaoReserva = { meses: 6, base: 'BRUTA', janelaMeses: 6 };

const mes = (n: number, bruto: number, liquido = bruto, transacoes = 10): MesDaJanela => ({
  mes: `2026-0${n}`,
  brutoCentavos: bruto,
  liquidoCentavos: liquido,
  transacoes,
});

/** Seis meses fechados com o mesmo gasto, para os testes que não falam de média. */
const seisMeses = (bruto: number, liquido = bruto) =>
  [1, 2, 3, 4, 5, 6].map((n) => mes(n, bruto, liquido));

const caixinha = (parcial: Partial<CaixinhaMarcada> = {}): CaixinhaMarcada => ({
  id: 'cx-1',
  nome: 'Caixinha de teste',
  saldoLiquidoCentavos: 100_000,
  saldoBrutoCentavos: 110_000,
  avisos: [],
  ...parcial,
});

describe('mediaParaCima', () => {
  it('CA-01: arredonda PARA CIMA (soma 1.000.001 em 6 meses → 166.667)', () => {
    expect(mediaParaCima(1_000_001, 6)).toBe(166_667);
  });

  it('divisão exata não sobe', () => {
    expect(mediaParaCima(600_000, 6)).toBe(100_000);
  });

  it.each([
    [1, 3, 1],
    [3, 3, 1],
    [4, 3, 2],
    [5, 3, 2],
    [6, 3, 2],
  ])('soma %i em %i meses → %i (teto)', (soma, n, esperado) => {
    expect(mediaParaCima(soma, n)).toBe(esperado);
  });

  it('sem meses ou sem gasto → 0 (nunca divide por zero)', () => {
    expect(mediaParaCima(1000, 0)).toBe(0);
    expect(mediaParaCima(0, 6)).toBe(0);
    expect(mediaParaCima(-500, 3)).toBe(0);
  });
});

describe('mesesComDados', () => {
  it('CA-04: meses ANTERIORES ao primeiro com transação não contam como "mês sem gasto"', () => {
    const m = [mes(1, 0, 0, 0), mes(2, 0, 0, 0), mes(3, 5000), mes(4, 6000)];
    expect(mesesComDados(m).map((x) => x.mes)).toEqual(['2026-03', '2026-04']);
  });

  it('um mês SEM gasto depois do início dos dados conta (gastar zero também é um dado)', () => {
    const m = [mes(1, 5000), mes(2, 0, 0, 3), mes(3, 5000)];
    expect(mesesComDados(m)).toHaveLength(3);
  });

  it('nenhum mês com transação → vazio', () => {
    expect(mesesComDados([mes(1, 0, 0, 0), mes(2, 0, 0, 0)])).toEqual([]);
  });
});

describe('calcularReserva — gasto, meta e base', () => {
  it('CA-01: a média bruta é a soma ÷ 6 para cima', () => {
    const r = calcularReserva({
      mesesDaJanela: [
        mes(1, 166_667),
        mes(2, 166_667),
        mes(3, 166_667),
        mes(4, 166_667),
        mes(5, 166_667),
        mes(6, 166_665),
      ],
      caixinhasMarcadas: [],
      configuracao: CONFIG,
    });

    // soma = 1.000.000 + ... : 5 × 166.667 + 166.665 = 1.000.000 → ÷ 6 = 166.666,67 → 166.667
    expect(r.mediaMensalBrutaCentavos).toBe(166_667);
  });

  it('CA-03: bruto e líquido saem iguais ao que a poupança deu, e a base padrão (BRUTA) manda na meta', () => {
    const r = calcularReserva({
      mesesDaJanela: seisMeses(300_000, 100_000),
      caixinhasMarcadas: [],
      configuracao: CONFIG,
    });

    expect(r.mediaMensalBrutaCentavos).toBe(300_000);
    expect(r.mediaMensalLiquidaCentavos).toBe(100_000);
    expect(r.mediaMensalCentavos).toBe(300_000);
    expect(r.baseUsada).toBe('BRUTA');
    expect(r.metaCentavos).toBe(1_800_000);
    expect(r.mesesConsiderados[0]).toEqual({
      mes: '2026-01',
      brutoCentavos: 300_000,
      liquidoCentavos: 100_000,
    });
  });

  it('CA-03: com a base LIQUIDA a meta usa a média líquida (trocar é só configuração)', () => {
    const r = calcularReserva({
      mesesDaJanela: seisMeses(300_000, 100_000),
      caixinhasMarcadas: [],
      configuracao: { ...CONFIG, base: 'LIQUIDA' },
    });

    expect(r.mediaMensalCentavos).toBe(100_000);
    expect(r.metaCentavos).toBe(600_000);
    // as DUAS médias continuam saindo, qualquer que seja a base
    expect(r.mediaMensalBrutaCentavos).toBe(300_000);
  });

  it('CA-06: a meta é média × meses (6 → 3 muda de 1.800.000 para 900.000)', () => {
    const base = { mesesDaJanela: seisMeses(300_000), caixinhasMarcadas: [] };
    expect(calcularReserva({ ...base, configuracao: CONFIG }).metaCentavos).toBe(1_800_000);
    expect(calcularReserva({ ...base, configuracao: { ...CONFIG, meses: 3 } }).metaCentavos).toBe(
      900_000,
    );
  });

  it('CA-04: só 3 meses com dados na janela de 6 → média dos 3 e HISTORICO_CURTO', () => {
    const r = calcularReserva({
      mesesDaJanela: [
        mes(1, 0, 0, 0),
        mes(2, 0, 0, 0),
        mes(3, 0, 0, 0),
        mes(4, 90_000),
        mes(5, 90_000),
        mes(6, 120_000),
      ],
      caixinhasMarcadas: [],
      configuracao: CONFIG,
    });

    expect(r.mesesConsiderados).toHaveLength(3);
    expect(r.mediaMensalBrutaCentavos).toBe(100_000);
    expect(r.avisos).toContain('HISTORICO_CURTO');
    expect(r.avisos).not.toContain('SEM_GASTOS_NA_JANELA');
  });

  it('janela completa não gera HISTORICO_CURTO', () => {
    const r = calcularReserva({
      mesesDaJanela: seisMeses(100_000),
      caixinhasMarcadas: [],
      configuracao: CONFIG,
    });
    expect(r.avisos).not.toContain('HISTORICO_CURTO');
  });

  it('CA-05: nenhuma despesa → SEM_GASTOS_NA_JANELA, meta 0, cobertura null e atingida false', () => {
    const r = calcularReserva({
      mesesDaJanela: seisMeses(0),
      caixinhasMarcadas: [caixinha()],
      configuracao: CONFIG,
    });

    expect(r.avisos).toContain('SEM_GASTOS_NA_JANELA');
    expect(r.metaCentavos).toBe(0);
    expect(r.coberturaMesesCentesimos).toBeNull();
    expect(r.atingida).toBe(false);
    expect(r.faltaCentavos).toBe(0);
  });

  it('janela sem nenhum mês com dados → SEM_GASTOS_NA_JANELA (e não HISTORICO_CURTO)', () => {
    const r = calcularReserva({
      mesesDaJanela: [mes(1, 0, 0, 0), mes(2, 0, 0, 0)],
      caixinhasMarcadas: [],
      configuracao: CONFIG,
    });

    expect(r.mesesConsiderados).toEqual([]);
    expect(r.avisos).toContain('SEM_GASTOS_NA_JANELA');
    expect(r.avisos).not.toContain('HISTORICO_CURTO');
  });

  it('despesa negativa (estorno maior que o gasto) vale 0, nunca crédito que reduz a média', () => {
    const r = calcularReserva({
      mesesDaJanela: [mes(1, -50_000, -50_000), mes(2, 100_000)],
      caixinhasMarcadas: [],
      configuracao: { ...CONFIG, janelaMeses: 2 },
    });

    expect(r.mesesConsiderados[0]).toMatchObject({ brutoCentavos: 0, liquidoCentavos: 0 });
    expect(r.mediaMensalBrutaCentavos).toBe(50_000);
  });
});

describe('calcularReserva — saldo da reserva', () => {
  it('CA-07: soma o saldo líquido estimado das Caixinhas marcadas', () => {
    const r = calcularReserva({
      mesesDaJanela: seisMeses(100_000),
      caixinhasMarcadas: [
        caixinha({
          id: 'a',
          nome: 'A',
          saldoLiquidoCentavos: 250_000,
          saldoBrutoCentavos: 260_000,
        }),
        caixinha({ id: 'b', nome: 'B', saldoLiquidoCentavos: 80_000, saldoBrutoCentavos: 85_000 }),
      ],
      configuracao: CONFIG,
    });

    expect(r.saldoCentavos).toBe(330_000);
    expect(r.caixinhas).toEqual([
      { id: 'a', nome: 'A', saldoCentavos: 250_000, baseDoSaldo: 'LIQUIDO_ESTIMADO' },
      { id: 'b', nome: 'B', saldoCentavos: 80_000, baseDoSaldo: 'LIQUIDO_ESTIMADO' },
    ]);
  });

  it('CA-09: imposto não configurado (líquido null) → usa o BRUTO daquela Caixinha e avisa', () => {
    const r = calcularReserva({
      mesesDaJanela: seisMeses(100_000),
      caixinhasMarcadas: [caixinha({ saldoLiquidoCentavos: null, saldoBrutoCentavos: 120_000 })],
      configuracao: CONFIG,
    });

    expect(r.saldoCentavos).toBe(120_000);
    expect(r.caixinhas[0]!.baseDoSaldo).toBe('BRUTO_ESTIMADO');
    expect(r.avisos).toContain('IMPOSTO_NAO_CONFIGURADO');
  });

  it('repassa CDI_DEFASADO e SEM_SALDO_INFORMADO das marcadas, e NÃO repassa RESGATE_ACIMA_DO_SALDO', () => {
    const r = calcularReserva({
      mesesDaJanela: seisMeses(100_000),
      caixinhasMarcadas: [
        caixinha({ avisos: ['CDI_DEFASADO', 'RESGATE_ACIMA_DO_SALDO'] }),
        caixinha({ id: 'b', avisos: ['SEM_SALDO_INFORMADO', 'CDI_DEFASADO'] }),
      ],
      configuracao: CONFIG,
    });

    expect(r.avisos).toEqual(['CDI_DEFASADO', 'SEM_SALDO_INFORMADO']);
  });

  it('CA-10: nenhuma Caixinha marcada → saldo 0, NENHUMA_CAIXINHA_MARCADA e cobertura 0 (há gasto)', () => {
    const r = calcularReserva({
      mesesDaJanela: seisMeses(100_000),
      caixinhasMarcadas: [],
      configuracao: CONFIG,
    });

    expect(r.saldoCentavos).toBe(0);
    expect(r.avisos).toContain('NENHUMA_CAIXINHA_MARCADA');
    expect(r.coberturaMesesCentesimos).toBe(0);
    expect(r.faltaCentavos).toBe(600_000);
    expect(r.atingida).toBe(false);
  });
});

describe('calcularReserva — cobertura, falta e meta atingida', () => {
  const comSaldo = (saldo: number) =>
    calcularReserva({
      mesesDaJanela: seisMeses(100_000),
      caixinhasMarcadas: [caixinha({ saldoLiquidoCentavos: saldo })],
      configuracao: CONFIG,
    });

  it('CA-11: saldo 450.000 e média 100.000 → cobertura 450 (4,50 meses), falta 150.000, não atingida', () => {
    const r = comSaldo(450_000);

    expect(r.metaCentavos).toBe(600_000);
    expect(r.coberturaMesesCentesimos).toBe(450);
    expect(r.faltaCentavos).toBe(150_000);
    expect(r.atingida).toBe(false);
  });

  it('CA-11: saldo exatamente na meta → falta 0 e atingida (limite inclusivo)', () => {
    const r = comSaldo(600_000);

    expect(r.faltaCentavos).toBe(0);
    expect(r.atingida).toBe(true);
    expect(r.coberturaMesesCentesimos).toBe(600);
  });

  it('um centavo abaixo da meta não está atingida', () => {
    const r = comSaldo(599_999);

    expect(r.atingida).toBe(false);
    expect(r.faltaCentavos).toBe(1);
  });

  it('saldo acima da meta → falta 0 (nunca negativa) e atingida', () => {
    const r = comSaldo(900_000);

    expect(r.faltaCentavos).toBe(0);
    expect(r.atingida).toBe(true);
    expect(r.coberturaMesesCentesimos).toBe(900);
  });

  it('a cobertura trunca (não arredonda para cima): 1,999 mês é 199', () => {
    // média 100.000 e saldo 199.999 → 199,999 centésimos → 199
    expect(comSaldo(199_999).coberturaMesesCentesimos).toBe(199);
  });

  it('os avisos saem sem duplicata e na ordem fixa', () => {
    const r = calcularReserva({
      mesesDaJanela: [mes(1, 0, 0, 0), mes(2, 100_000)],
      caixinhasMarcadas: [
        caixinha({ saldoLiquidoCentavos: null, avisos: ['SEM_SALDO_INFORMADO', 'CDI_DEFASADO'] }),
        caixinha({ id: 'b', saldoLiquidoCentavos: null, avisos: ['CDI_DEFASADO'] }),
      ],
      configuracao: CONFIG,
    });

    expect(r.avisos).toEqual([
      'HISTORICO_CURTO',
      'IMPOSTO_NAO_CONFIGURADO',
      'CDI_DEFASADO',
      'SEM_SALDO_INFORMADO',
    ]);
  });
});

describe('calcularReserva — teste de propriedade (CA-20)', () => {
  // Gerador determinístico (LCG): o mesmo teste roda igual em qualquer máquina.
  function* aleatorio(semente: number) {
    let s = semente;
    while (true) {
      s = (s * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      yield s / 4_294_967_296;
    }
  }

  it('200 entradas aleatórias: tudo inteiro, falta ≥ 0, falta + min(saldo, meta) = meta', () => {
    const g = aleatorio(20261006);
    const int = (max: number) => Math.floor(g.next().value! * max);

    for (let i = 0; i < 200; i++) {
      const meses = Array.from({ length: int(7) }, (_, k) =>
        mes((k % 9) + 1, int(2_000_000) - 100_000, int(2_000_000) - 100_000, int(3)),
      );
      const marcadas = Array.from({ length: int(4) }, (_, k) =>
        caixinha({
          id: `c${k}`,
          saldoLiquidoCentavos: int(3) === 0 ? null : int(5_000_000),
          saldoBrutoCentavos: int(5_000_000),
        }),
      );
      const r = calcularReserva({
        mesesDaJanela: meses,
        caixinhasMarcadas: marcadas,
        configuracao: {
          meses: 1 + int(60),
          base: int(2) === 0 ? 'BRUTA' : 'LIQUIDA',
          janelaMeses: 1 + int(24),
        },
      });

      for (const v of [
        r.mediaMensalBrutaCentavos,
        r.mediaMensalLiquidaCentavos,
        r.mediaMensalCentavos,
        r.metaCentavos,
        r.saldoCentavos,
        r.faltaCentavos,
      ]) {
        expect(Number.isInteger(v)).toBe(true);
      }
      if (r.coberturaMesesCentesimos !== null)
        expect(Number.isInteger(r.coberturaMesesCentesimos)).toBe(true);
      expect(r.faltaCentavos).toBeGreaterThanOrEqual(0);
      expect(r.faltaCentavos + Math.min(r.saldoCentavos, r.metaCentavos)).toBe(r.metaCentavos);
      expect(r.atingida).toBe(r.metaCentavos > 0 && r.saldoCentavos >= r.metaCentavos);
      expect(r.mediaMensalCentavos).toBe(
        r.baseUsada === 'BRUTA' ? r.mediaMensalBrutaCentavos : r.mediaMensalLiquidaCentavos,
      );
    }
  });
});
