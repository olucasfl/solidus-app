import { assertCentavos, formatarCentavosBRL } from './centavos';

describe('assertCentavos', () => {
  it('aceita inteiro e devolve o mesmo valor', () => {
    expect(assertCentavos(1050)).toBe(1050);
  });

  it('rejeita valor fracionário', () => {
    expect(() => assertCentavos(10.5)).toThrow(TypeError);
  });

  it('rejeita NaN e Infinity', () => {
    expect(() => assertCentavos(NaN)).toThrow(TypeError);
    expect(() => assertCentavos(Infinity)).toThrow(TypeError);
  });
});

describe('formatarCentavosBRL', () => {
  it('formata valor positivo com milhar e centavos', () => {
    expect(formatarCentavosBRL(123456)).toBe('R$ 1.234,56');
  });

  it('formata zero', () => {
    expect(formatarCentavosBRL(0)).toBe('R$ 0,00');
  });

  it('formata valor negativo', () => {
    expect(formatarCentavosBRL(-500)).toBe('-R$ 5,00');
  });
});
