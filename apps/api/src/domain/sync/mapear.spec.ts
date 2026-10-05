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

describe('mapearTransacao — contraparte (spec 07)', () => {
  const SEGREDO = 's'.repeat(32);
  const pix = (parcial: Partial<TransacaoPluggy>) =>
    tx({
      description: 'Transferência Recebida|MARIA TESTE',
      paymentData: {
        payer: { name: 'Maria Teste', documentNumber: { value: '123.456.789-09' } },
        receiver: { name: 'Eu Mesmo', documentNumber: { value: '987.654.321-00' } },
      },
      ...parcial,
    });

  it('entrada usa o PAGADOR como contraparte', () => {
    const r = mapearTransacao(pix({ type: 'CREDIT', amount: 100 }), SEGREDO);
    expect(r.contraparteChave).toMatch(/^[0-9a-f]{64}$/);
    expect(r.contraparteNome).toBe('Maria Teste');
    expect(r.contraparteDocMascarado).toBe('***.456.789-**');
  });

  it('saída usa o RECEBEDOR como contraparte (chave diferente da do pagador)', () => {
    const entrada = mapearTransacao(pix({ type: 'CREDIT', amount: 100 }), SEGREDO);
    const saida = mapearTransacao(pix({ type: 'DEBIT', amount: -100 }), SEGREDO);
    expect(saida.contraparteDocMascarado).toBe('***.654.321-**');
    expect(saida.contraparteChave).not.toBe(entrada.contraparteChave);
  });

  it('a mesma pessoa gera a mesma chave em transações diferentes', () => {
    const a = mapearTransacao(pix({ id: 'a', type: 'CREDIT', amount: 10 }), SEGREDO);
    const b = mapearTransacao(pix({ id: 'b', type: 'CREDIT', amount: 99 }), SEGREDO);
    expect(a.contraparteChave).toBe(b.contraparteChave);
  });

  it('o documento em claro não aparece em nenhum campo mapeado', () => {
    const r = mapearTransacao(pix({ type: 'CREDIT', amount: 100 }), SEGREDO);
    expect(JSON.stringify(r)).not.toContain('12345678909');
    expect(JSON.stringify(r)).not.toContain('123.456.789-09');
  });

  it('sem paymentData (cartão, tarifa) ou sem segredo → contraparte nula', () => {
    const semDados = mapearTransacao(tx({ type: 'DEBIT', amount: -10 }), SEGREDO);
    expect(semDados.contraparteChave).toBeNull();
    expect(semDados.contraparteNome).toBeNull();
    expect(semDados.contraparteDocMascarado).toBeNull();
    expect(mapearTransacao(pix({ type: 'CREDIT', amount: 100 })).contraparteChave).toBeNull();
  });

  it('Pix sem documento válido não tem contraparte (só nome não identifica)', () => {
    const r = mapearTransacao(
      pix({ type: 'CREDIT', amount: 100, paymentData: { payer: { name: 'Maria Teste' } } }),
      SEGREDO,
    );
    expect(r.contraparteChave).toBeNull();
  });
});
