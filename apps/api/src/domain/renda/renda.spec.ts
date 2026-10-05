import { categoriaDaFonte, fonteDaTransacao, type FonteAplicavel } from './aplicar-fontes';
import { detectarRecorrentes } from './detectar-recorrentes';

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
  const c = (chave: string, data: string) => ({ chave, data: d(data) });

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

  it('separa origens diferentes e respeita o mínimo configurável', () => {
    const creditos = [
      c('x', '2026-01-05'),
      c('x', '2026-02-05'),
      c('y', '2026-01-06'),
      c('y', '2026-02-06'),
      c('y', '2026-03-06'),
    ];
    expect(detectarRecorrentes(creditos).map((r) => r.chave)).toEqual(['y']);
    expect(
      detectarRecorrentes(creditos, 2)
        .map((r) => r.chave)
        .sort(),
    ).toEqual(['x', 'y']);
  });

  it('lista vazia → nada', () => {
    expect(detectarRecorrentes([])).toEqual([]);
  });
});
