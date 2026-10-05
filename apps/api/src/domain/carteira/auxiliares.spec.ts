import { dataIsoDoBcb, dataParaBcb, taxaE8DoBcb } from './bcb';
import { diasEntre, ehDataIso, somarDias } from './datas';
import { IOF_PADRAO, IR_PADRAO } from './impostos-padrao';
import { totaisDaCarteira } from './totais';
import { validarFaixas } from './validar-faixas';

describe('taxaE8DoBcb (CA-19) — exato, por string', () => {
  it.each([
    ['0.055131', 55_131],
    ['0.05', 50_000],
    ['0.1', 100_000],
    ['1', 1_000_000],
    ['0.000001', 1],
    ['12.345678', 12_345_678],
    [' 0.055131 ', 55_131],
  ])('"%s" → %d', (entrada, esperado) => {
    expect(taxaE8DoBcb(entrada)).toBe(esperado);
  });

  it.each([[''], ['abc'], ['0,055131'], ['1e-3'], ['0.0551311'], ['-0.05'], ['.5'], ['1234.5']])(
    'formato inesperado "%s" é erro, nunca um valor errado',
    (entrada) => {
      expect(() => taxaE8DoBcb(entrada)).toThrow(TypeError);
    },
  );
});

describe('datas do BCB', () => {
  it('converte dd/MM/yyyy ⇄ YYYY-MM-DD', () => {
    expect(dataIsoDoBcb('02/01/2026')).toBe('2026-01-02');
    expect(dataParaBcb('2026-01-02')).toBe('02/01/2026');
  });

  it('rejeita formato inesperado', () => {
    expect(() => dataIsoDoBcb('2026-01-02')).toThrow(TypeError);
    expect(() => dataIsoDoBcb('2/1/2026')).toThrow(TypeError);
  });
});

describe('datas', () => {
  it('ehDataIso valida formato e existência (31/02 não existe)', () => {
    expect(ehDataIso('2026-02-28')).toBe(true);
    expect(ehDataIso('2026-02-30')).toBe(false);
    expect(ehDataIso('2026-13-01')).toBe(false);
    expect(ehDataIso('02/01/2026')).toBe(false);
    expect(ehDataIso(20260101)).toBe(false);
  });

  it('diasEntre e somarDias atravessam mês e ano (e bissexto)', () => {
    expect(diasEntre('2025-12-31', '2026-01-01')).toBe(1);
    expect(diasEntre('2028-02-28', '2028-03-01')).toBe(2);
    expect(diasEntre('2026-01-10', '2026-01-01')).toBe(-9);
    expect(somarDias('2025-12-30', 5)).toBe('2026-01-04');
    expect(somarDias('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('totaisDaCarteira (CA-12)', () => {
  it('patrimônio soma tudo que está ativo; investido exclui a reserva; inativas ficam fora', () => {
    const t = totaisDaCarteira([
      { ativa: true, reservaDeGastos: false, saldoBrutoCentavos: 500_000 },
      { ativa: true, reservaDeGastos: false, saldoBrutoCentavos: 200_000 },
      { ativa: true, reservaDeGastos: true, saldoBrutoCentavos: 30_000 },
      { ativa: false, reservaDeGastos: false, saldoBrutoCentavos: 999_999 },
    ]);

    expect(t).toEqual({
      patrimonioCentavos: 730_000,
      investidoCentavos: 700_000,
      disponivelParaGastarCentavos: 30_000,
    });
  });

  it('sem Caixinhas tudo é zero', () => {
    expect(totaisDaCarteira([])).toEqual({
      patrimonioCentavos: 0,
      investidoCentavos: 0,
      disponivelParaGastarCentavos: 0,
    });
  });
});

describe('semente das tabelas de imposto', () => {
  it('IOF: 96% no dia 1, 3% no dia 29, 0 a partir do 30º; sempre decrescente', () => {
    expect(IOF_PADRAO[0]).toEqual({ ateDias: 1, aliquotaBp: 9_600 });
    expect(IOF_PADRAO[28]).toEqual({ ateDias: 29, aliquotaBp: 300 });
    expect(IOF_PADRAO[29]).toEqual({ ateDias: null, aliquotaBp: 0 });
    expect(IOF_PADRAO).toHaveLength(30);
    for (let i = 1; i < IOF_PADRAO.length; i += 1) {
      expect(IOF_PADRAO[i]!.aliquotaBp).toBeLessThan(IOF_PADRAO[i - 1]!.aliquotaBp);
    }
  });

  it('IR regressivo: 22,5% / 20% / 17,5% / 15%, só a última sem limite', () => {
    expect(IR_PADRAO.map((f) => f.aliquotaBp)).toEqual([2_250, 2_000, 1_750, 1_500]);
    expect(IR_PADRAO.filter((f) => f.ateDias === null)).toHaveLength(1);
    expect(IR_PADRAO.at(-1)!.ateDias).toBeNull();
  });
});

describe('validarFaixas (CA-17)', () => {
  it('aceita as tabelas semente e a tabela vazia', () => {
    expect(validarFaixas(IR_PADRAO)).toEqual([]);
    expect(validarFaixas(IOF_PADRAO)).toEqual([]);
    expect(validarFaixas([])).toEqual([]);
  });

  it.each([
    [
      'fora de ordem',
      [
        { ateDias: 10, aliquotaBp: 1 },
        { ateDias: 5, aliquotaBp: 1 },
      ],
    ],
    [
      'repetida',
      [
        { ateDias: 10, aliquotaBp: 1 },
        { ateDias: 10, aliquotaBp: 1 },
      ],
    ],
    ['dias zero', [{ ateDias: 0, aliquotaBp: 1 }]],
    ['dias fracionários', [{ ateDias: 1.5, aliquotaBp: 1 }]],
    ['alíquota > 100%', [{ ateDias: 10, aliquotaBp: 10_001 }]],
    ['alíquota negativa', [{ ateDias: 10, aliquotaBp: -1 }]],
    [
      'nulo no meio',
      [
        { ateDias: null, aliquotaBp: 1 },
        { ateDias: 10, aliquotaBp: 1 },
      ],
    ],
    [
      'dois nulos',
      [
        { ateDias: null, aliquotaBp: 1 },
        { ateDias: null, aliquotaBp: 1 },
      ],
    ],
  ])('%s é rejeitada com explicação', (_nome, faixas) => {
    expect(validarFaixas(faixas).length).toBeGreaterThan(0);
  });
});
