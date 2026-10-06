import { categoriaDaFonte, fonteDaTransacao, type FonteAplicavel } from './aplicar-fontes';
import { CRITERIOS_PADRAO, detectarRecorrentes } from './detectar-recorrentes';

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

function fonte(parcial: Partial<FonteAplicavel> = {}): FonteAplicavel {
  return {
    tipo: 'SALARIO',
    chave: 'chave-a',
    vigenteDesde: d('2026-01-01'),
    vigenteAte: null,
    ativa: true,
    ...parcial,
  };
}

const entrada = (
  data: string,
  chave: string | null = 'chave-a',
  tipo: 'CREDITO' | 'DEBITO' = 'CREDITO',
) => ({
  tipo,
  contraparteChave: chave,
  data: d(data),
});

describe('categoriaDaFonte', () => {
  it('entrada da origem do salário vira SALARIO (passada e futura)', () => {
    expect(categoriaDaFonte(entrada('2026-01-05'), [fonte()])).toBe('SALARIO');
    expect(categoriaDaFonte(entrada('2027-03-05'), [fonte()])).toBe('SALARIO');
  });

  it('fonte recorrente vira OUTRAS_RECEITAS', () => {
    expect(categoriaDaFonte(entrada('2026-02-10'), [fonte({ tipo: 'RECORRENTE' })])).toBe(
      'OUTRAS_RECEITAS',
    );
  });

  it('origem diferente, sem contraparte ou saída não é renda', () => {
    expect(categoriaDaFonte(entrada('2026-02-10', 'chave-b'), [fonte()])).toBeNull();
    expect(categoriaDaFonte(entrada('2026-02-10', null), [fonte()])).toBeNull();
    expect(categoriaDaFonte(entrada('2026-02-10', 'chave-a', 'DEBITO'), [fonte()])).toBeNull();
  });

  it('fonte desativada não conta', () => {
    expect(categoriaDaFonte(entrada('2026-02-10'), [fonte({ ativa: false })])).toBeNull();
  });

  it('respeita a vigência: antes do início e depois do fim não é salário daquela fonte', () => {
    const f = fonte({ vigenteDesde: d('2026-03-01'), vigenteAte: d('2026-06-30') });
    expect(categoriaDaFonte(entrada('2026-02-28'), [f])).toBeNull();
    expect(categoriaDaFonte(entrada('2026-03-01'), [f])).toBe('SALARIO');
    expect(categoriaDaFonte(entrada('2026-06-30'), [f])).toBe('SALARIO');
    expect(categoriaDaFonte(entrada('2026-07-01'), [f])).toBeNull();
  });

  it('a vigência compara por dia, não pela hora', () => {
    const f = fonte({ vigenteAte: new Date('2026-06-30T00:00:00Z') });
    expect(
      categoriaDaFonte(
        { tipo: 'CREDITO', contraparteChave: 'chave-a', data: new Date('2026-06-30T23:59:59Z') },
        [f],
      ),
    ).toBe('SALARIO');
  });

  it('troca de origem: A até o dia anterior, B a partir do dia da troca; o passado de A fica', () => {
    const antiga = fonte({ chave: 'chave-a', vigenteAte: d('2026-05-31') });
    const nova = fonte({ chave: 'chave-b', vigenteDesde: d('2026-06-01') });
    const fontes = [antiga, nova];
    expect(categoriaDaFonte(entrada('2026-05-05', 'chave-a'), fontes)).toBe('SALARIO');
    expect(categoriaDaFonte(entrada('2026-06-05', 'chave-a'), fontes)).toBeNull();
    expect(categoriaDaFonte(entrada('2026-06-05', 'chave-b'), fontes)).toBe('SALARIO');
    expect(categoriaDaFonte(entrada('2026-05-05', 'chave-b'), fontes)).toBeNull();
  });

  it('duas fontes de salário ao mesmo tempo funcionam de forma independente', () => {
    const fontes = [fonte({ chave: 'chave-a' }), fonte({ chave: 'chave-b' })];
    expect(categoriaDaFonte(entrada('2026-02-10', 'chave-a'), fontes)).toBe('SALARIO');
    expect(categoriaDaFonte(entrada('2026-02-10', 'chave-b'), fontes)).toBe('SALARIO');
  });
});

describe('fonteDaTransacao', () => {
  it('SALARIO vence RECORRENTE quando as duas casam (o usuário promoveu a origem)', () => {
    const recorrente = fonte({ tipo: 'RECORRENTE' });
    const salario = fonte({ tipo: 'SALARIO' });
    expect(fonteDaTransacao(entrada('2026-02-10'), [recorrente, salario])).toBe(salario);
  });

  it('devolve null sem nenhuma fonte', () => {
    expect(fonteDaTransacao(entrada('2026-02-10'), [])).toBeNull();
  });
});

describe('detectarRecorrentes', () => {
  // Valor padrão R$ 1.000: bem acima do mínimo, para os testes de meses/frequência não dependerem dele.
  const c = (chave: string, data: string, valorCentavos = 100_000) => ({
    chave,
    data: d(data),
    valorCentavos,
  });
  const chaves = (r: { chave: string }[]) => r.map((x) => x.chave);

  it('3 meses distintos → recorrente, com o primeiro recebimento como início', () => {
    const r = detectarRecorrentes([
      c('x', '2026-03-10'),
      c('x', '2026-01-05'),
      c('x', '2026-02-07'),
    ]);
    expect(r).toEqual([{ chave: 'x', desde: d('2026-01-05') }]);
  });

  it('2 meses não basta', () => {
    expect(detectarRecorrentes([c('x', '2026-01-05'), c('x', '2026-02-05')])).toEqual([]);
  });

  it('vários pagamentos no MESMO mês contam como um mês só', () => {
    expect(
      detectarRecorrentes([c('x', '2026-03-01'), c('x', '2026-03-10'), c('x', '2026-03-20')]),
    ).toEqual([]);
  });

  it('3 meses não consecutivos também contam', () => {
    expect(
      detectarRecorrentes([c('x', '2026-01-05'), c('x', '2026-04-05'), c('x', '2026-09-05')]),
    ).toHaveLength(1);
  });

  it('lista vazia → nada', () => {
    expect(detectarRecorrentes([])).toEqual([]);
  });

  describe('frequência: rateio paga muitas vezes por mês, renda não', () => {
    const noMes = (chave: string, mes: string, quantos: number) =>
      Array.from({ length: quantos }, (_, i) =>
        c(chave, `${mes}-${String(i + 1).padStart(2, '0')}`),
      );

    it('exatamente 2 pagamentos por mês, em 3 meses, ainda é recorrente (limite inclusivo)', () => {
      const creditos = [
        ...noMes('x', '2026-01', 2),
        ...noMes('x', '2026-02', 2),
        ...noMes('x', '2026-03', 2),
      ];
      expect(chaves(detectarRecorrentes(creditos))).toEqual(['x']);
    });

    it('um pagamento a mais que o limite (7 em 3 meses) deixa de ser recorrente', () => {
      const creditos = [
        ...noMes('x', '2026-01', 3),
        ...noMes('x', '2026-02', 2),
        ...noMes('x', '2026-03', 2),
      ];
      expect(creditos).toHaveLength(7);
      expect(detectarRecorrentes(creditos)).toEqual([]);
    });

    it('é a MÉDIA por mês ativo: um mês com 3 compensado por outros com 1 passa', () => {
      const creditos = [
        ...noMes('x', '2026-01', 3),
        ...noMes('x', '2026-02', 1),
        ...noMes('x', '2026-03', 1),
        ...noMes('x', '2026-04', 1),
      ];
      expect(chaves(detectarRecorrentes(creditos))).toEqual(['x']);
    });

    it('padrão real de rateio: 55 pagamentos pequenos em 13 meses (≈ 4 por mês) não é renda', () => {
      const creditos = Array.from({ length: 55 }, (_, i) =>
        c(
          'rateio',
          `2025-${String((i % 13) + 1).padStart(2, '0')}`.replace('2025-13', '2026-01') + '-10',
          8_500,
        ),
      );
      expect(detectarRecorrentes(creditos)).toEqual([]);
    });

    it('padrão real de pagador frequente: 48 pagamentos de ≈ R$ 612 em 13 meses (≈ 3,7 por mês) não é renda', () => {
      const creditos = Array.from({ length: 48 }, (_, i) =>
        c('frequente', `2025-${String((i % 12) + 1).padStart(2, '0')}-10`, 61_200),
      );
      expect(detectarRecorrentes(creditos)).toEqual([]);
    });
  });

  describe('valor médio mínimo de R$ 300', () => {
    const tresMeses = (valorCentavos: number) => [
      c('x', '2026-01-05', valorCentavos),
      c('x', '2026-02-05', valorCentavos),
      c('x', '2026-03-05', valorCentavos),
    ];

    it('exatamente R$ 300 de média passa (limite inclusivo)', () => {
      expect(chaves(detectarRecorrentes(tresMeses(30_000)))).toEqual(['x']);
    });

    it('R$ 299,99 não passa', () => {
      expect(detectarRecorrentes(tresMeses(29_999))).toEqual([]);
    });

    it('padrão real de rateio pequeno: R$ 36 a R$ 199 por mês, mesmo todo mês, não é renda', () => {
      expect(detectarRecorrentes(tresMeses(3_600))).toEqual([]);
      expect(detectarRecorrentes(tresMeses(19_900))).toEqual([]);
    });

    it('vale a MÉDIA, não cada pagamento: um pequeno e um grande podem passar juntos', () => {
      const r = detectarRecorrentes([
        c('x', '2026-01-05', 10_000),
        c('x', '2026-02-05', 80_000),
        c('x', '2026-03-05', 40_000),
      ]);
      expect(chaves(r)).toEqual(['x']); // média = 43.333 ≥ 30.000
    });

    it('a comparação é toda em inteiros (soma ≥ mínimo × pagamentos), sem arredondar a média', () => {
      // média real = 29.999,67: um arredondamento ingênuo para 30.000 deixaria passar.
      const r = detectarRecorrentes([
        c('x', '2026-01-05', 30_000),
        c('x', '2026-02-05', 30_000),
        c('x', '2026-03-05', 29_999),
      ]);
      expect(r).toEqual([]);
    });
  });

  it('separa origens diferentes e respeita critérios configuráveis', () => {
    const creditos = [
      c('x', '2026-01-05'),
      c('x', '2026-02-05'),
      c('y', '2026-01-06'),
      c('y', '2026-02-06'),
      c('y', '2026-03-06'),
    ];
    expect(chaves(detectarRecorrentes(creditos))).toEqual(['y']);
    expect(
      chaves(detectarRecorrentes(creditos, { ...CRITERIOS_PADRAO, minMeses: 2 })).sort(),
    ).toEqual(['x', 'y']);
  });

  it('os limites escolhidos estão onde a spec diz (3 meses, 2 por mês, R$ 300)', () => {
    expect(CRITERIOS_PADRAO).toEqual({
      minMeses: 3,
      maxPagamentosPorMes: 2,
      valorMedioMinimoCentavos: 30_000,
    });
  });
});
