import { mapearConta, mapearTransacao, type TransacaoPluggy } from './mapear';

function tx(parcial: Partial<TransacaoPluggy>): TransacaoPluggy {
  return {
    id: 'tx-1',
    date: '2026-09-01T00:00:00.000Z',
    description: 'Compra de teste',
    type: 'DEBIT',
    amount: 10,
    amountInAccountCurrency: null,
    currencyCode: 'BRL',
    category: null,
    ...parcial,
  };
}

describe('mapearTransacao — sinal pelo type', () => {
  it('CA-02: DEBIT negativo (corrente) e DEBIT positivo (cartão) viram a mesma saída', () => {
    expect(mapearTransacao(tx({ type: 'DEBIT', amount: -50.25 })).valorCentavos).toBe(-5025);
    expect(mapearTransacao(tx({ type: 'DEBIT', amount: 50.25 })).valorCentavos).toBe(-5025);
  });

  it('CA-03: CREDIT positivo (corrente) e CREDIT negativo (cartão) viram a mesma entrada', () => {
    expect(mapearTransacao(tx({ type: 'CREDIT', amount: 100 })).valorCentavos).toBe(10000);
    expect(mapearTransacao(tx({ type: 'CREDIT', amount: -100 })).valorCentavos).toBe(10000);
    expect(mapearTransacao(tx({ type: 'CREDIT', amount: 100 })).tipo).toBe('CREDITO');
  });
});

describe('mapearTransacao — moeda estrangeira', () => {
  it('CA-04: usa amountInAccountCurrency quando existe', () => {
    const r = mapearTransacao(
      tx({ currencyCode: 'USD', amount: 10, amountInAccountCurrency: 52.1 }),
    );
    expect(r.valorCentavos).toBe(-5210);
    expect(r.semConversao).toBe(false);
    expect(r.moeda).toBe('USD');
  });

  it('CA-04: sem valor convertido, usa o cru e sinaliza semConversao', () => {
    const r = mapearTransacao(
      tx({ currencyCode: 'USD', amount: 10, amountInAccountCurrency: null }),
    );
    expect(r.valorCentavos).toBe(-1000);
    expect(r.semConversao).toBe(true);
  });

  it('BRL nunca é semConversao', () => {
    expect(mapearTransacao(tx({})).semConversao).toBe(false);
  });
});

describe('mapearTransacao — status e campos', () => {
  it('CA-05: PENDING/POSTED/ausente', () => {
    expect(mapearTransacao(tx({ status: 'PENDING' })).status).toBe('PENDENTE');
    expect(mapearTransacao(tx({ status: 'POSTED' })).status).toBe('EFETIVADA');
    expect(mapearTransacao(tx({})).status).toBe('EFETIVADA');
  });

  it('trunca textos longos e preserva a categoria auxiliar', () => {
    const r = mapearTransacao(tx({ description: 'x'.repeat(900), category: 'Mercado' }));
    expect(r.descricao).toHaveLength(500);
    expect(r.categoriaPluggy).toBe('Mercado');
  });
});

describe('mapearConta', () => {
  const base = { id: 'a1', name: 'Conta', balance: 12.34, currencyCode: 'BRL' };

  it('CA-13: mapeia os tipos conhecidos e ignora o desconhecido', () => {
    expect(mapearConta({ ...base, type: 'BANK', subtype: 'CHECKING_ACCOUNT' })?.tipo).toBe(
      'CORRENTE',
    );
    expect(mapearConta({ ...base, type: 'BANK', subtype: 'SAVINGS_ACCOUNT' })?.tipo).toBe(
      'POUPANCA',
    );
    expect(mapearConta({ ...base, type: 'CREDIT', subtype: 'CREDIT_CARD' })?.tipo).toBe('CARTAO');
    expect(mapearConta({ ...base, type: 'BANK', subtype: 'OUTRO' })).toBeNull();
  });

  it('converte o saldo para centavos', () => {
    expect(mapearConta({ ...base, type: 'BANK', subtype: 'CHECKING_ACCOUNT' })?.saldoCentavos).toBe(
      1234,
    );
  });
});
