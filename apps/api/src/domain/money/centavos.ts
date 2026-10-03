/**
 * Dinheiro é sempre um inteiro de centavos — nunca float (RULES.md). Esta função é o único lugar
 * que decide o que conta como "inteiro": qualquer valor fracionário, NaN ou infinito é erro de
 * quem chamou, não um caso para arredondar silenciosamente.
 */
export function assertCentavos(valor: number): number {
  if (!Number.isInteger(valor)) {
    throw new TypeError(`Valor em centavos precisa ser um inteiro, recebido ${valor}`);
  }
  return valor;
}

/** Formata centavos como "R$ 1.234,56", só para exibição — nunca use o resultado em cálculo. */
export function formatarCentavosBRL(centavos: number): string {
  assertCentavos(centavos);

  const negativo = centavos < 0;
  const absoluto = Math.abs(centavos);
  const reais = Math.floor(absoluto / 100);
  const resto = absoluto % 100;

  return `${negativo ? '-' : ''}R$ ${reais.toLocaleString('pt-BR')},${resto.toString().padStart(2, '0')}`;
}

/**
 * Converte um valor em reais (decimal, como as APIs externas devolvem) para centavos inteiros,
 * arredondando para o centavo mais próximo. É a única porta de entrada de dinheiro externo: NaN e
 * infinito são erro de quem chamou, nunca um valor a "consertar".
 */
export function reaisParaCentavos(reais: number): number {
  if (!Number.isFinite(reais)) {
    throw new TypeError(`Valor em reais precisa ser finito, recebido ${reais}`);
  }
  // Deslocar a vírgula na string evita 1.005 * 100 = 100.49999... arredondar para baixo.
  const centavos = Math.sign(reais) * Math.round(Number(`${Math.abs(reais).toFixed(10)}e2`));
  return centavos === 0 ? 0 : centavos;
}
