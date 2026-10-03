import { CATEGORIAS, naturezaDe } from '@solidus/shared';
import { categorizar, type EntradaCategorizacao, type RegraUsuario } from './categorizar';
import { normalizar } from './normalizar';

function entrada(p: Partial<EntradaCategorizacao>): EntradaCategorizacao {
  return { descricao: 'Algo', tipo: 'DEBITO', categoriaPluggy: null, ...p };
}

function regra(p: Partial<RegraUsuario>): RegraUsuario {
  return {
    padrao: 'padaria',
    categoria: 'MERCADO',
    tipo: null,
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

  it('CA-03: transferência para si mesmo é TRANSFERENCIA_INTERNA nos dois sentidos', () => {
    expect(cat({ tipo: 'DEBITO', categoriaPluggy: 'Same person transfer' })).toBe(
      'TRANSFERENCIA_INTERNA',
    );
    expect(cat({ tipo: 'CREDITO', categoriaPluggy: 'Same person transfer' })).toBe(
      'TRANSFERENCIA_INTERNA',
    );
  });

  it('CA-04: Transfers de entrada é A_CLASSIFICAR; de saída é despesa', () => {
    expect(cat({ tipo: 'CREDITO', categoriaPluggy: 'Transfers' })).toBe('A_CLASSIFICAR');
    expect(cat({ tipo: 'CREDITO', categoriaPluggy: 'Third party transfers' })).toBe(
      'A_CLASSIFICAR',
    );
    expect(cat({ tipo: 'DEBITO', categoriaPluggy: 'Transfers' })).toBe('TRANSFERENCIAS_ENVIADAS');
    expect(naturezaDe('A_CLASSIFICAR')).toBe('INDEFINIDA');
    expect(naturezaDe('TRANSFERENCIAS_ENVIADAS')).toBe('DESPESA');
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

describe('taxonomia', () => {
  it('CA-18: ids únicos, toda categoria tem natureza válida e o conjunto bate com a spec', () => {
    const ids = CATEGORIAS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(22);
    for (const c of CATEGORIAS) {
      expect(['RECEITA', 'DESPESA', 'NEUTRA', 'INDEFINIDA']).toContain(naturezaDe(c.id));
    }
    expect(
      CATEGORIAS.filter((c) => c.natureza === 'NEUTRA')
        .map((c) => c.id)
        .sort(),
    ).toEqual(['INVESTIMENTO', 'PAGAMENTO_FATURA', 'TRANSFERENCIA_INTERNA']);
    expect(
      CATEGORIAS.filter((c) => c.natureza === 'RECEITA')
        .map((c) => c.id)
        .sort(),
    ).toEqual(['OUTRAS_RECEITAS', 'RENDIMENTOS_CASHBACK', 'SALARIO']);
  });
});
