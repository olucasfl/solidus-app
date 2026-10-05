import { CATEGORIAS, naturezaDe } from '@solidus/shared';
import { categorizar, type EntradaCategorizacao, type RegraUsuario } from './categorizar';
import { normalizar } from './normalizar';

function entrada(p: Partial<EntradaCategorizacao>): EntradaCategorizacao {
  return { descricao: 'Algo', tipo: 'DEBITO', categoriaPluggy: null, valorCentavos: -1000, ...p };
}

function regra(p: Partial<RegraUsuario>): RegraUsuario {
  return {
    padrao: 'padaria',
    categoria: 'MERCADO',
    tipo: null,
    valorMinCentavos: null,
    valorMaxCentavos: null,
    prioridade: 0,
    criadoEm: new Date('2026-01-01T00:00:00Z'),
    ...p,
  };
}

const cat = (p: Partial<EntradaCategorizacao>, regras: RegraUsuario[] = []) =>
  categorizar(entrada(p), regras).categoria;

describe('normalizar', () => {
  it('tira acento, caixa e espaços repetidos', () => {
    expect(normalizar('  PÁDARIA   São  José ')).toBe('padaria sao jose');
  });
});

describe('regras padrão por descrição e por tipo de movimento', () => {
  it('CA-01: pagamento de fatura (dos dois lados) é PAGAMENTO_FATURA mesmo com Pluggy "Transfers"', () => {
    expect(
      cat({ descricao: 'Pagamento de fatura', tipo: 'DEBITO', categoriaPluggy: 'Transfers' }),
    ).toBe('PAGAMENTO_FATURA');
    expect(
      cat({
        descricao: 'Pagamento recebido',
        tipo: 'CREDITO',
        categoriaPluggy: 'Credit card payment',
      }),
    ).toBe('PAGAMENTO_FATURA');
  });

  it('CA-02: aplicação e resgate são INVESTIMENTO', () => {
    expect(cat({ descricao: 'Resgate RDB', tipo: 'CREDITO', categoriaPluggy: 'Investments' })).toBe(
      'INVESTIMENTO',
    );
    expect(
      cat({ descricao: 'Aplicação RDB', tipo: 'DEBITO', categoriaPluggy: 'Investments' }),
    ).toBe('INVESTIMENTO');
    expect(cat({ descricao: 'Aplicação X', categoriaPluggy: 'Fixed income' })).toBe('INVESTIMENTO');
  });

  it('CA-03 (spec 07): conta própria é neutra nos DOIS sentidos, não mais A_CLASSIFICAR', () => {
    expect(cat({ tipo: 'DEBITO', categoriaPluggy: 'Same person transfer' })).toBe(
      'TRANSFERENCIA_INTERNA',
    );
    expect(cat({ tipo: 'CREDITO', categoriaPluggy: 'Same person transfer' })).toBe(
      'TRANSFERENCIA_INTERNA',
    );
  });

  it('CA-04: Pix/transferência de e para pessoas tem categoria própria (neutra por padrão)', () => {
    expect(cat({ tipo: 'CREDITO', categoriaPluggy: 'Transfers' })).toBe('PIX_RECEBIDO_DE_PESSOAS');
    expect(cat({ tipo: 'CREDITO', categoriaPluggy: 'Third party transfers' })).toBe(
      'PIX_RECEBIDO_DE_PESSOAS',
    );
    expect(cat({ tipo: 'DEBITO', categoriaPluggy: 'Transfers' })).toBe('PIX_ENVIADO_PARA_PESSOAS');
    expect(naturezaDe('PIX_RECEBIDO_DE_PESSOAS')).toBe('NEUTRA');
    expect(naturezaDe('PIX_ENVIADO_PARA_PESSOAS')).toBe('NEUTRA');
  });

  it('CA-04b: o usuário reclassifica um Pix específico por regra (ex.: aluguel é despesa, cliente é renda)', () => {
    const pix = (tipo: 'DEBITO' | 'CREDITO', descricao: string) =>
      entrada({ tipo, descricao, categoriaPluggy: 'Transfers' });
    const regras = [
      regra({ padrao: 'proprietario joao', categoria: 'MORADIA', tipo: 'DEBITO' }),
      regra({ padrao: 'cliente acme', categoria: 'OUTRAS_RECEITAS', tipo: 'CREDITO' }),
    ];

    expect(categorizar(pix('DEBITO', 'Pix|PROPRIETARIO JOAO'), regras).categoria).toBe('MORADIA');
    expect(categorizar(pix('CREDITO', 'Pix|CLIENTE ACME'), regras).categoria).toBe(
      'OUTRAS_RECEITAS',
    );
    expect(categorizar(pix('DEBITO', 'Pix|AMIGA'), regras).categoria).toBe(
      'PIX_ENVIADO_PARA_PESSOAS',
    );
  });

  it.each([
    ['Groceries', 'MERCADO'],
    ['Eating out', 'RESTAURANTES_DELIVERY'],
    ['Food delivery', 'RESTAURANTES_DELIVERY'],
    ['Taxi and ride-hailing', 'TRANSPORTE'],
    ['Parking', 'TRANSPORTE'],
    ['Gas stations', 'TRANSPORTE'],
    ['Automotive', 'TRANSPORTE'],
    ['Pharmacy', 'SAUDE'],
    ['Cinema, theater and concerts', 'LAZER'],
    ['Tickets', 'LAZER'],
    ['Gambling', 'LAZER'],
    ['Bookstore', 'EDUCACAO'],
    ['Office supplies', 'EDUCACAO'],
    ['Digital services', 'ASSINATURAS_COMUNICACAO'],
    ['Telecommunications', 'ASSINATURAS_COMUNICACAO'],
    ['Shopping', 'COMPRAS'],
    ['Online shopping', 'COMPRAS'],
    ['Clothing', 'COMPRAS'],
    ['Electronics', 'COMPRAS'],
    ['Sports goods', 'COMPRAS'],
    ['Kids and toys', 'COMPRAS'],
    ['Travel', 'VIAGENS'],
    ['Donations', 'DOACOES'],
    ['Tax on financial operations', 'IMPOSTOS_TARIFAS'],
    ['Services', 'SERVICOS'],
  ])('CA-05: Pluggy "%s" → %s', (pluggy, esperado) => {
    expect(cat({ tipo: 'DEBITO', categoriaPluggy: pluggy })).toBe(esperado);
  });

  it('CA-05: cashback de entrada é receita; categoria desconhecida cai no fallback por tipo', () => {
    expect(cat({ tipo: 'CREDITO', categoriaPluggy: 'Cashback' })).toBe('RENDIMENTOS_CASHBACK');
    expect(cat({ tipo: 'DEBITO', categoriaPluggy: 'Categoria Nova' })).toBe('OUTRAS_DESPESAS');
    expect(cat({ tipo: 'CREDITO', categoriaPluggy: 'Categoria Nova' })).toBe('A_CLASSIFICAR');
    expect(cat({ tipo: 'DEBITO', categoriaPluggy: null })).toBe('OUTRAS_DESPESAS');
  });

  it('estorno de compra (crédito Shopping) fica em COMPRAS', () => {
    expect(cat({ tipo: 'CREDITO', categoriaPluggy: 'Shopping' })).toBe('COMPRAS');
  });
});

describe('regras do usuário', () => {
  const compra = entrada({
    descricao: 'COMPRA NO DÉBITO - Padaria São José',
    categoriaPluggy: 'Shopping',
  });

  it('CA-06: casa sem acento/caixa e vence a regra padrão', () => {
    for (const padrao of ['padaria', 'PADARIA', 'pádaria', '  sao   jose ']) {
      expect(categorizar(compra, [regra({ padrao })])).toEqual({
        categoria: 'MERCADO',
        origem: 'REGRA_USUARIO',
      });
    }
    expect(categorizar(compra, []).origem).toBe('REGRA_PADRAO');
  });

  it('CA-07: maior prioridade vence; empate vence a mais antiga', () => {
    const baixa = regra({ categoria: 'LAZER', prioridade: 5 });
    const alta = regra({ categoria: 'SAUDE', prioridade: 10 });
    expect(categorizar(compra, [baixa, alta]).categoria).toBe('SAUDE');

    const antiga = regra({ categoria: 'LAZER', criadoEm: new Date('2026-01-01') });
    const nova = regra({ categoria: 'SAUDE', criadoEm: new Date('2026-06-01') });
    expect(categorizar(compra, [nova, antiga]).categoria).toBe('LAZER');
  });

  it('CA-08: regra restrita a CREDITO não casa débito', () => {
    expect(categorizar(compra, [regra({ tipo: 'CREDITO' })]).origem).toBe('REGRA_PADRAO');
    expect(categorizar(compra, [regra({ tipo: 'DEBITO' })]).origem).toBe('REGRA_USUARIO');
  });

  it('CA-09: o padrão é texto literal, nunca regex', () => {
    const r = [regra({ padrao: 'a.*b' })];
    expect(categorizar(entrada({ descricao: 'axxb' }), r).origem).toBe('REGRA_PADRAO');
    expect(categorizar(entrada({ descricao: 'tem a.*b aqui' }), r).origem).toBe('REGRA_USUARIO');
  });

  it('padrão vazio nunca casa (não pega tudo)', () => {
    expect(categorizar(compra, [regra({ padrao: '   ' })]).origem).toBe('REGRA_PADRAO');
  });
});

describe('regra com faixa de valor (salário ≈ R$ 1.044 vs. transferências próprias pequenas)', () => {
  const salario = regra({
    padrao: 'lucas farias leandro',
    categoria: 'SALARIO',
    tipo: 'CREDITO',
    valorMinCentavos: 80_000,
    valorMaxCentavos: 150_000,
  });
  const propria = (valorCentavos: number) =>
    entrada({
      descricao: 'Transferência Recebida|LUCAS FARIAS LEANDRO',
      tipo: 'CREDITO',
      categoriaPluggy: 'Same person transfer',
      valorCentavos,
    });

  it('CA-21: dentro da faixa (inclusive nas bordas) a regra do usuário vence a padrão', () => {
    for (const valor of [104_442, 97_585, 80_000, 150_000]) {
      expect(categorizar(propria(valor), [salario])).toEqual({
        categoria: 'SALARIO',
        origem: 'REGRA_USUARIO',
      });
    }
  });

  it('CA-22: fora da faixa a regra não casa e cai na padrão (entrada própria é neutra, nunca salário por palpite)', () => {
    for (const valor of [1_000, 5_000, 12_038, 79_999, 150_001]) {
      expect(categorizar(propria(valor), [salario])).toEqual({
        categoria: 'TRANSFERENCIA_INTERNA',
        origem: 'REGRA_PADRAO',
      });
    }
  });

  it('a faixa compara o módulo do valor (vale também para saídas) e aceita só um dos limites', () => {
    const aluguel = regra({ padrao: 'aluguel', categoria: 'MORADIA', valorMinCentavos: 50_000 });
    const saida = (valorCentavos: number) => entrada({ descricao: 'Pix aluguel', valorCentavos });

    expect(categorizar(saida(-90_000), [aluguel]).categoria).toBe('MORADIA');
    expect(categorizar(saida(-10_000), [aluguel]).categoria).not.toBe('MORADIA');
  });
});

describe('taxonomia — robustez', () => {
  it('categoria desconhecida (antiga) é INDEFINIDA, nunca um erro', () => {
    expect(naturezaDe('TRANSFERENCIAS_ENVIADAS')).toBe('INDEFINIDA');
    expect(naturezaDe('QUALQUER_COISA')).toBe('INDEFINIDA');
  });
});

describe('taxonomia', () => {
  it('CA-18: ids únicos, toda categoria tem natureza válida e o conjunto bate com a spec', () => {
    const ids = CATEGORIAS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(23);
    for (const c of CATEGORIAS) {
      expect(['RECEITA', 'DESPESA', 'NEUTRA', 'INDEFINIDA']).toContain(naturezaDe(c.id));
    }
    expect(
      CATEGORIAS.filter((c) => c.natureza === 'NEUTRA')
        .map((c) => c.id)
        .sort(),
    ).toEqual([
      'INVESTIMENTO',
      'PAGAMENTO_FATURA',
      'PIX_ENVIADO_PARA_PESSOAS',
      'PIX_RECEBIDO_DE_PESSOAS',
      'TRANSFERENCIA_INTERNA',
    ]);
    expect(
      CATEGORIAS.filter((c) => c.natureza === 'RECEITA')
        .map((c) => c.id)
        .sort(),
    ).toEqual(['OUTRAS_RECEITAS', 'RENDIMENTOS_CASHBACK', 'SALARIO']);
  });
});

describe('fonte de renda na categorização (spec 07)', () => {
  const fonteSalario = {
    tipo: 'SALARIO' as const,
    chave: 'origem-x',
    vigenteDesde: new Date('2026-01-01T00:00:00Z'),
    vigenteAte: null,
    ativa: true,
  };
  const pix = (p: Partial<EntradaCategorizacao> = {}) =>
    entrada({
      tipo: 'CREDITO',
      categoriaPluggy: 'Transfers',
      valorCentavos: 100000,
      contraparteChave: 'origem-x',
      data: new Date('2026-03-05T12:00:00Z'),
      ...p,
    });

  it('entrada da origem marcada como salário vira SALARIO com origem FONTE_RENDA', () => {
    expect(categorizar(pix(), [], [fonteSalario])).toEqual({
      categoria: 'SALARIO',
      origem: 'FONTE_RENDA',
    });
  });

  it('sem a fonte, o mesmo Pix de pessoa continua no padrão (PIX_RECEBIDO_DE_PESSOAS)', () => {
    expect(categorizar(pix(), [], [])).toEqual({
      categoria: 'PIX_RECEBIDO_DE_PESSOAS',
      origem: 'REGRA_PADRAO',
    });
  });

  it('a regra do usuário vence a fonte de renda', () => {
    const r = regra({ padrao: 'algo', categoria: 'OUTRAS_RECEITAS' });
    expect(categorizar(pix({ descricao: 'Algo' }), [r], [fonteSalario])).toEqual({
      categoria: 'OUTRAS_RECEITAS',
      origem: 'REGRA_USUARIO',
    });
  });

  it('a fonte vence a categoria do Pluggy e o padrão "Same person transfer"', () => {
    expect(
      categorizar(pix({ categoriaPluggy: 'Same person transfer' }), [], [fonteSalario]).categoria,
    ).toBe('SALARIO');
  });

  it('fora da vigência a fonte não se aplica', () => {
    const encerrada = { ...fonteSalario, vigenteAte: new Date('2026-02-28T00:00:00Z') };
    expect(categorizar(pix(), [], [encerrada]).categoria).toBe('PIX_RECEBIDO_DE_PESSOAS');
  });

  it('sem data na entrada nenhuma fonte casa (nunca chuta)', () => {
    expect(categorizar(pix({ data: undefined }), [], [fonteSalario]).origem).toBe('REGRA_PADRAO');
  });
});
