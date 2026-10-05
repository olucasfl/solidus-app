import {
  hashDocumento,
  mapearContraparte,
  mascararDocumento,
  nomeDaContraparte,
} from './documento';

// Dados 100% sintéticos (RULES §8): CPF/CNPJ de exemplo, nunca um documento real do spike.
const SEGREDO = 's'.repeat(32);
const CPF = '123.456.789-09';
const CNPJ = '12.345.678/0001-95';

describe('hashDocumento', () => {
  it('devolve um HMAC hex de 64 caracteres que não contém o documento', () => {
    const chave = hashDocumento(CPF, SEGREDO);
    expect(chave).toMatch(/^[0-9a-f]{64}$/);
    expect(chave).not.toContain('12345678909');
  });

  it('é o mesmo para o documento com ou sem pontuação (a origem é uma só)', () => {
    expect(hashDocumento('12345678909', SEGREDO)).toBe(hashDocumento(CPF, SEGREDO));
  });

  it('muda com o segredo (o hash sozinho não identifica ninguém)', () => {
    expect(hashDocumento(CPF, SEGREDO)).not.toBe(
      hashDocumento(CPF, 'outro-segredo-qualquer-32-bytes!!'),
    );
  });

  it('distingue documentos diferentes', () => {
    expect(hashDocumento(CPF, SEGREDO)).not.toBe(hashDocumento(CNPJ, SEGREDO));
  });

  it.each([null, undefined, '', '123', '1234567890123', 'abc'])(
    'não é CPF nem CNPJ (%p) → null',
    (valor) => {
      expect(hashDocumento(valor, SEGREDO)).toBeNull();
    },
  );
});

describe('mascararDocumento', () => {
  it('CPF mostra só o miolo', () => {
    expect(mascararDocumento(CPF)).toBe('***.456.789-**');
  });

  it('CNPJ esconde o fim', () => {
    expect(mascararDocumento(CNPJ)).toBe('**.345.678/****-**');
  });

  it('a máscara nunca revela o documento inteiro', () => {
    expect(mascararDocumento(CPF)).not.toContain('123');
    expect(mascararDocumento(CPF)).not.toContain('09');
  });

  it.each([null, undefined, '', '123'])('inválido (%p) → null', (valor) => {
    expect(mascararDocumento(valor)).toBeNull();
  });
});

describe('nomeDaContraparte', () => {
  it('usa o nome do Pluggy quando vem', () => {
    expect(nomeDaContraparte('Maria Teste', 'Transferência Recebida|OUTRO NOME')).toBe(
      'Maria Teste',
    );
  });

  it('extrai o nome depois do | em entrada', () => {
    expect(nomeDaContraparte(undefined, 'Transferência Recebida|MARIA TESTE DA SILVA')).toBe(
      'MARIA TESTE DA SILVA',
    );
  });

  it('extrai o nome depois do | em saída', () => {
    expect(nomeDaContraparte(null, 'Transferência enviada pelo Pix|JOAO EXEMPLO')).toBe(
      'JOAO EXEMPLO',
    );
  });

  it('remove hífen suave e espaços repetidos que aparecem nas descrições reais', () => {
    expect(nomeDaContraparte(undefined, 'Transferência Recebida|MARIA­  TESTE')).toBe(
      'MARIA TESTE',
    );
  });

  it('sem | e sem nome do Pluggy → null (a tela mostra a máscara)', () => {
    expect(nomeDaContraparte(undefined, 'Pagamento de boleto')).toBeNull();
    expect(nomeDaContraparte('   ', 'Transferência Recebida|')).toBeNull();
  });
});

describe('mapearContraparte', () => {
  it('monta chave, nome e máscara a partir do participante', () => {
    const r = mapearContraparte(
      { name: 'Empresa Teste', documentNumber: { value: CNPJ } },
      'Transferência Recebida|EMPRESA TESTE LTDA',
      SEGREDO,
    );
    expect(r).toEqual({
      chave: hashDocumento(CNPJ, SEGREDO),
      nome: 'Empresa Teste',
      docMascarado: '**.345.678/****-**',
    });
  });

  it('sem documento válido não há contraparte (nome sozinho pode ser homônimo)', () => {
    expect(
      mapearContraparte({ name: 'Maria Teste' }, 'Transferência Recebida|MARIA TESTE', SEGREDO),
    ).toBeNull();
    expect(mapearContraparte(undefined, 'x', SEGREDO)).toBeNull();
  });

  it('nenhum campo devolvido contém o documento em claro', () => {
    const r = mapearContraparte(
      { documentNumber: { value: CPF } },
      'Transferência Recebida|MARIA TESTE',
      SEGREDO,
    );
    expect(JSON.stringify(r)).not.toContain('12345678909');
    expect(JSON.stringify(r)).not.toContain(CPF);
  });
});
