import {
  calcularEnvelopes,
  type CaixinhaParaEnvelopes,
  type ContaParaEnvelopes,
  type EnvelopeEntrada,
} from './calcular-envelopes';

// Dados 100% sintéticos (RULES §8): nenhum número do spike.
const cx = (parcial: Partial<CaixinhaParaEnvelopes> = {}): CaixinhaParaEnvelopes => ({
  ativa: true,
  reservaEmergencia: false,
  saldoLiquidoCentavos: 100_000,
  saldoBrutoCentavos: 110_000,
  avisos: [],
  ...parcial,
});
const conta = (tipo: ContaParaEnvelopes['tipo'], saldoCentavos: number): ContaParaEnvelopes => ({
  tipo,
  saldoCentavos,
});
const env = (parcial: Partial<EnvelopeEntrada> = {}): EnvelopeEntrada => ({
  id: 'e1',
  nome: 'Viagem',
  alocadoCentavos: 0,
  metaCentavos: null,
  ...parcial,
});
const base = {
  caixinhas: [] as CaixinhaParaEnvelopes[],
  contas: [conta('CORRENTE', 0)],
  reservaMetaCentavos: 0,
  envelopes: [] as EnvelopeEntrada[],
};

describe('calcularEnvelopes — de onde vem o dinheiro', () => {
  it('CA-01: total = Caixinhas ativas (líquido) + conta corrente + poupança', () => {
    const r = calcularEnvelopes({
      ...base,
      caixinhas: [cx({ saldoLiquidoCentavos: 250_000 }), cx({ saldoLiquidoCentavos: 80_000 })],
      contas: [conta('CORRENTE', 4_545), conta('POUPANCA', 10_000)],
    });

    expect(r.caixinhasCentavos).toBe(330_000);
    expect(r.contaCorrenteCentavos).toBe(14_545);
    expect(r.totalCentavos).toBe(344_545);
  });

  it('CA-02: líquido nulo (imposto não configurado) → entra pelo BRUTO e avisa', () => {
    const r = calcularEnvelopes({
      ...base,
      caixinhas: [cx({ saldoLiquidoCentavos: null, saldoBrutoCentavos: 120_000 })],
    });

    expect(r.caixinhasCentavos).toBe(120_000);
    expect(r.avisos).toContain('IMPOSTO_NAO_CONFIGURADO');
  });

  it('CA-02: Caixinha INATIVA não entra no total, nem seus avisos', () => {
    const r = calcularEnvelopes({
      ...base,
      caixinhas: [
        cx({ saldoLiquidoCentavos: 100_000 }),
        cx({
          ativa: false,
          saldoLiquidoCentavos: null,
          saldoBrutoCentavos: 999_999,
          avisos: ['CDI_DEFASADO'],
        }),
      ],
    });

    expect(r.caixinhasCentavos).toBe(100_000);
    expect(r.avisos).not.toContain('IMPOSTO_NAO_CONFIGURADO');
    expect(r.avisos).not.toContain('CDI_DEFASADO');
  });

  it('CA-03: o saldo do CARTÃO nunca soma (foi gravado cru) e gera FATURA_DO_CARTAO_NAO_DESCONTADA', () => {
    const r = calcularEnvelopes({
      ...base,
      contas: [conta('CORRENTE', 10_000), conta('CARTAO', 9_492)],
    });

    expect(r.contaCorrenteCentavos).toBe(10_000);
    expect(r.totalCentavos).toBe(10_000);
    expect(r.avisos).toContain('FATURA_DO_CARTAO_NAO_DESCONTADA');
  });

  it('cartão com saldo zero não gera o aviso da fatura', () => {
    const r = calcularEnvelopes({
      ...base,
      contas: [conta('CORRENTE', 1_000), conta('CARTAO', 0)],
    });

    expect(r.avisos).not.toContain('FATURA_DO_CARTAO_NAO_DESCONTADA');
  });

  it('CA-04: nenhuma conta corrente/poupança → 0 e SEM_CONTA_SINCRONIZADA (só cartão também conta como "nenhuma")', () => {
    expect(calcularEnvelopes({ ...base, contas: [] })).toMatchObject({
      contaCorrenteCentavos: 0,
      avisos: ['SEM_CONTA_SINCRONIZADA'],
    });
    expect(calcularEnvelopes({ ...base, contas: [conta('CARTAO', 5_000)] }).avisos).toEqual([
      'FATURA_DO_CARTAO_NAO_DESCONTADA',
      'SEM_CONTA_SINCRONIZADA',
    ]);
  });

  it('repassa CDI_DEFASADO e SEM_SALDO_INFORMADO das Caixinhas ativas, e NÃO RESGATE_ACIMA_DO_SALDO', () => {
    const r = calcularEnvelopes({
      ...base,
      caixinhas: [
        cx({ avisos: ['CDI_DEFASADO', 'RESGATE_ACIMA_DO_SALDO'] }),
        cx({ avisos: ['SEM_SALDO_INFORMADO'] }),
      ],
    });

    expect(r.avisos).toEqual(['CDI_DEFASADO', 'SEM_SALDO_INFORMADO']);
  });
});

describe('calcularEnvelopes — a reserva de emergência automática', () => {
  it('CA-05: a reserva é o valor realizável INTEIRO das Caixinhas ativas e marcadas', () => {
    const r = calcularEnvelopes({
      ...base,
      caixinhas: [
        cx({ reservaEmergencia: true, saldoLiquidoCentavos: 450_000 }),
        cx({ reservaEmergencia: true, saldoLiquidoCentavos: 50_000 }),
        cx({ reservaEmergencia: false, saldoLiquidoCentavos: 999_999 }),
        cx({ reservaEmergencia: true, ativa: false, saldoLiquidoCentavos: 888_888 }),
      ],
      reservaMetaCentavos: 10_000_000,
    });

    expect(r.reservaValorCentavos).toBe(500_000);
  });

  it('CA-05: a reserva usa o bruto quando o líquido é nulo (mesma regra do total)', () => {
    const r = calcularEnvelopes({
      ...base,
      caixinhas: [
        cx({ reservaEmergencia: true, saldoLiquidoCentavos: null, saldoBrutoCentavos: 120_000 }),
      ],
    });

    expect(r.reservaValorCentavos).toBe(120_000);
  });

  it.each([
    [800_000, 600_000, 200_000], // acima da meta → excedente
    [600_000, 600_000, 0], // exatamente na meta
    [400_000, 600_000, 0], // abaixo da meta
    [800_000, 0, 0], // sem meta (sem gasto para calcular): nada de excedente
  ])('CA-06: reserva %i com meta %i → excedente %i', (reserva, meta, esperado) => {
    const r = calcularEnvelopes({
      ...base,
      caixinhas: [cx({ reservaEmergencia: true, saldoLiquidoCentavos: reserva })],
      reservaMetaCentavos: meta,
    });

    expect(r.reservaExcedenteCentavos).toBe(esperado);
    // acima da meta a reserva continua INTEIRA reservada: o excedente é só informação
    expect(r.reservaValorCentavos).toBe(reserva);
  });
});

describe('calcularEnvelopes — os envelopes e o livre', () => {
  it('CA-07: livre = total − reserva − Σ alocado', () => {
    const r = calcularEnvelopes({
      ...base,
      caixinhas: [
        cx({ reservaEmergencia: true, saldoLiquidoCentavos: 300_000 }),
        cx({ saldoLiquidoCentavos: 200_000 }),
      ],
      contas: [conta('CORRENTE', 50_000)],
      envelopes: [
        env({ id: 'a', alocadoCentavos: 120_000 }),
        env({ id: 'b', nome: 'Setup', alocadoCentavos: 30_000 }),
      ],
    });

    expect(r.totalCentavos).toBe(550_000);
    expect(r.totalAlocadoCentavos).toBe(150_000);
    expect(r.livreCentavos).toBe(550_000 - 300_000 - 150_000);
    expect(r.avisos).not.toContain('ALOCADO_ACIMA_DO_DISPONIVEL');
  });

  it('CA-08: livre exatamente zero não avisa; negativo avisa e NÃO é escondido', () => {
    const zero = calcularEnvelopes({
      ...base,
      caixinhas: [cx({ saldoLiquidoCentavos: 100_000 })],
      contas: [],
      envelopes: [env({ alocadoCentavos: 100_000 })],
    });
    expect(zero.livreCentavos).toBe(0);
    expect(zero.avisos).not.toContain('ALOCADO_ACIMA_DO_DISPONIVEL');

    const negativo = calcularEnvelopes({
      ...base,
      caixinhas: [cx({ saldoLiquidoCentavos: 100_000 })],
      contas: [],
      envelopes: [env({ alocadoCentavos: 100_001 })],
    });
    expect(negativo.livreCentavos).toBe(-1);
    expect(negativo.avisos).toContain('ALOCADO_ACIMA_DO_DISPONIVEL');
  });

  it('a reserva também reduz o livre (o mesmo dinheiro não conta duas vezes)', () => {
    const r = calcularEnvelopes({
      ...base,
      caixinhas: [cx({ reservaEmergencia: true, saldoLiquidoCentavos: 100_000 })],
      contas: [],
      envelopes: [env({ alocadoCentavos: 1 })],
    });

    expect(r.livreCentavos).toBe(-1);
    expect(r.avisos).toContain('ALOCADO_ACIMA_DO_DISPONIVEL');
  });

  it('sem nenhum dinheiro e nenhum envelope: tudo zero', () => {
    const r = calcularEnvelopes({ ...base, contas: [] });

    expect(r).toMatchObject({ totalCentavos: 0, livreCentavos: 0, totalAlocadoCentavos: 0 });
  });
});

describe('calcularEnvelopes — progresso de cada envelope', () => {
  const um = (alocado: number, meta: number | null) =>
    calcularEnvelopes({
      ...base,
      envelopes: [env({ alocadoCentavos: alocado, metaCentavos: meta })],
    }).envelopes[0]!;

  it('CA-09: alocado 25.000 de meta 100.000 → 25%, falta 75.000, não atingida', () => {
    expect(um(25_000, 100_000)).toMatchObject({
      progressoBp: 2_500,
      faltaCentavos: 75_000,
      atingida: false,
    });
  });

  it('CA-09: alocado igual à meta → atingida (limite inclusivo)', () => {
    expect(um(100_000, 100_000)).toMatchObject({
      progressoBp: 10_000,
      faltaCentavos: 0,
      atingida: true,
    });
  });

  it('CA-09: alocado acima da meta → progresso passa de 10000 e a falta nunca é negativa', () => {
    expect(um(150_000, 100_000)).toMatchObject({
      progressoBp: 15_000,
      faltaCentavos: 0,
      atingida: true,
    });
  });

  it('um centavo abaixo da meta não está atingida', () => {
    expect(um(99_999, 100_000)).toMatchObject({
      faltaCentavos: 1,
      atingida: false,
      progressoBp: 9_999,
    });
  });

  it('o progresso trunca (não arredonda): 1 de 3 = 33,33% → 3333', () => {
    expect(um(1, 3).progressoBp).toBe(3_333);
  });

  it('CA-09: sem meta → progresso e falta nulos e atingida false (alocado 0 ou não)', () => {
    expect(um(0, null)).toMatchObject({
      metaCentavos: null,
      progressoBp: null,
      faltaCentavos: null,
      atingida: false,
    });
    expect(um(50_000, null)).toMatchObject({
      progressoBp: null,
      faltaCentavos: null,
      atingida: false,
    });
  });

  it('meta 0 (dado inválido que escapasse) é tratada como sem meta, nunca divide por zero', () => {
    expect(um(10_000, 0)).toMatchObject({ metaCentavos: null, progressoBp: null });
  });

  it('mantém a ordem dos envelopes recebida e devolve o contrato completo', () => {
    const r = calcularEnvelopes({
      ...base,
      envelopes: [env({ id: 'b', nome: 'B' }), env({ id: 'a', nome: 'A' })],
    });

    expect(r.envelopes.map((e) => e.id)).toEqual(['b', 'a']);
    expect(Object.keys(r.envelopes[0]!).sort()).toEqual(
      [
        'alocadoCentavos',
        'atingida',
        'faltaCentavos',
        'id',
        'metaCentavos',
        'nome',
        'progressoBp',
      ].sort(),
    );
  });
});

describe('calcularEnvelopes — avisos', () => {
  it('saem sem duplicata e na ordem fixa', () => {
    const r = calcularEnvelopes({
      ...base,
      caixinhas: [
        cx({ saldoLiquidoCentavos: null, avisos: ['SEM_SALDO_INFORMADO', 'CDI_DEFASADO'] }),
        cx({ saldoLiquidoCentavos: null, avisos: ['CDI_DEFASADO'] }),
      ],
      contas: [conta('CARTAO', 100)],
      // aloca MAIS do que existe (as duas Caixinhas somam 220.000) para o livre ficar negativo
      envelopes: [env({ alocadoCentavos: 5_000_000 })],
    });

    expect(r.avisos).toEqual([
      'ALOCADO_ACIMA_DO_DISPONIVEL',
      'FATURA_DO_CARTAO_NAO_DESCONTADA',
      'SEM_CONTA_SINCRONIZADA',
      'IMPOSTO_NAO_CONFIGURADO',
      'CDI_DEFASADO',
      'SEM_SALDO_INFORMADO',
    ]);
  });
});

describe('calcularEnvelopes — teste de propriedade (CA-18)', () => {
  // Gerador determinístico (LCG): o mesmo teste roda igual em qualquer máquina.
  function* aleatorio(semente: number) {
    let s = semente;
    while (true) {
      s = (s * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      yield s / 4_294_967_296;
    }
  }

  it('200 entradas aleatórias: tudo inteiro e livre + reserva + totalAlocado = total', () => {
    const g = aleatorio(20261007);
    const int = (max: number) => Math.floor(g.next().value! * max);

    for (let i = 0; i < 200; i++) {
      const caixinhas = Array.from({ length: int(5) }, () =>
        cx({
          ativa: int(4) !== 0,
          reservaEmergencia: int(3) === 0,
          saldoLiquidoCentavos: int(4) === 0 ? null : int(5_000_000),
          saldoBrutoCentavos: int(5_000_000),
        }),
      );
      const contas = Array.from({ length: int(4) }, () =>
        conta((['CORRENTE', 'POUPANCA', 'CARTAO'] as const)[int(3)]!, int(2_000_000) - 100_000),
      );
      const envelopes = Array.from({ length: int(6) }, (_, k) =>
        env({
          id: `e${k}`,
          nome: `E${k}`,
          alocadoCentavos: int(3_000_000),
          metaCentavos: int(3) === 0 ? null : 1 + int(3_000_000),
        }),
      );
      const r = calcularEnvelopes({
        caixinhas,
        contas,
        reservaMetaCentavos: int(4_000_000),
        envelopes,
      });

      for (const v of [
        r.caixinhasCentavos,
        r.contaCorrenteCentavos,
        r.totalCentavos,
        r.reservaValorCentavos,
        r.reservaExcedenteCentavos,
        r.totalAlocadoCentavos,
        r.livreCentavos,
      ]) {
        expect(Number.isInteger(v)).toBe(true);
      }
      for (const e of r.envelopes) {
        expect(Number.isInteger(e.alocadoCentavos)).toBe(true);
        if (e.progressoBp !== null) expect(Number.isInteger(e.progressoBp)).toBe(true);
        if (e.faltaCentavos !== null) expect(e.faltaCentavos).toBeGreaterThanOrEqual(0);
      }
      expect(r.livreCentavos + r.reservaValorCentavos + r.totalAlocadoCentavos).toBe(
        r.totalCentavos,
      );
      expect(r.reservaExcedenteCentavos).toBeGreaterThanOrEqual(0);
      expect(r.avisos.includes('ALOCADO_ACIMA_DO_DISPONIVEL')).toBe(r.livreCentavos < 0);
    }
  });
});
