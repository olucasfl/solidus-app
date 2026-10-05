import { conferirCaixinha } from './conferir';
import { type DataIso } from './datas';
import { type Movimento } from './projetar';

const saldo = (data: DataIso, valorCentavos: number): Movimento => ({
  tipo: 'SALDO',
  data,
  valorCentavos,
});
const aporte = (data: DataIso, valorCentavos: number): Movimento => ({
  tipo: 'APORTE',
  data,
  valorCentavos,
});

// 0,1% ao dia a 100% do CDI => fator 1,001 exato
const cdi = new Map<DataIso, number>([
  ['2026-01-02', 100_000],
  ['2026-01-05', 100_000],
]);
const base = { percentualCdiBp: 10_000, cdi };

describe('conferirCaixinha — o app se confere com os saldos que o usuário já informou', () => {
  const comAporte = (informado: number): Movimento[] => [
    saldo('2026-01-01', 100_000),
    aporte('2026-01-02', 50_000),
    saldo('2026-01-05', informado),
  ];

  it('banco que rende desde o dia da aplicação → sugere ANTES e o erro dele é zero', () => {
    // ANTES: 150.000 x 1,001 x 1,001 = 150.300,15 → 150.300
    const r = conferirCaixinha({ ...base, movimentos: comAporte(150_300) });

    const antes = r.porConvencao.find((c) => c.convencao === 'MOVIMENTO_ANTES_DO_RENDIMENTO')!;
    const depois = r.porConvencao.find((c) => c.convencao === 'MOVIMENTO_DEPOIS_DO_RENDIMENTO')!;
    expect(antes.erroAbsolutoTotalCentavos).toBe(0);
    expect(depois.erroAbsolutoTotalCentavos).toBe(50); // 150.250 estimado
    expect(depois.comparacoes[0]!.diferencaCentavos).toBe(50);
    expect(r.convencaoSugerida).toBe('MOVIMENTO_ANTES_DO_RENDIMENTO');
  });

  it('banco que só rende a partir do dia seguinte → sugere DEPOIS', () => {
    // DEPOIS: (100.000 x 1,001 + 50.000) x 1,001 = 150.250,1 → 150.250
    const r = conferirCaixinha({ ...base, movimentos: comAporte(150_250) });

    expect(r.convencaoSugerida).toBe('MOVIMENTO_DEPOIS_DO_RENDIMENTO');
  });

  it('sem aporte/resgate no meio as convenções empatam e nada é sugerido (os saldos não distinguem)', () => {
    const r = conferirCaixinha({
      ...base,
      movimentos: [saldo('2026-01-01', 100_000), saldo('2026-01-05', 100_200)],
    });

    expect(r.convencaoSugerida).toBeNull();
    expect(r.porConvencao[0]!.comparacoes).toHaveLength(1);
  });

  it('com um único saldo (ou nenhum) não há o que comparar', () => {
    expect(conferirCaixinha({ ...base, movimentos: [saldo('2026-01-01', 100_000)] })).toMatchObject(
      {
        convencaoSugerida: null,
        porConvencao: [{ comparacoes: [] }, { comparacoes: [] }],
      },
    );
    expect(conferirCaixinha({ ...base, movimentos: [] }).convencaoSugerida).toBeNull();
  });

  it('compara cada par consecutivo de saldos (três saldos = duas comparações)', () => {
    const r = conferirCaixinha({
      ...base,
      movimentos: [
        saldo('2026-01-01', 100_000),
        saldo('2026-01-02', 100_100),
        saldo('2026-01-05', 100_200),
      ],
    });

    expect(r.porConvencao[0]!.comparacoes.map((c) => [c.de, c.ate])).toEqual([
      ['2026-01-01', '2026-01-02'],
      ['2026-01-02', '2026-01-05'],
    ]);
  });
});
