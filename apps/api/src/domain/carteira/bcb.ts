import { type DataIso } from './datas';

/**
 * Converte o `valor` do CDI diário do BCB (série 12, "% ao dia", ex.: `"0.055131"`) em inteiro x10^8
 * (fração diária: 0,055131% = 0,00055131 => 55131). Exato, por string — nunca passa por `float`.
 * Formato inesperado (vírgula, notação científica, mais de 6 casas) é erro: melhor falhar do que
 * gravar um CDI silenciosamente errado.
 */
export function taxaE8DoBcb(valor: string): number {
  const m = /^(\d{1,3})(?:\.(\d{1,6}))?$/.exec(valor.trim());
  if (!m) {
    throw new TypeError(`Valor de CDI fora do formato esperado: ${valor}`);
  }
  const inteira = Number(m[1]);
  const fracao = Number((m[2] ?? '').padEnd(6, '0'));
  return inteira * 1_000_000 + fracao;
}

/** `dd/MM/yyyy` (formato do BCB) => `YYYY-MM-DD`. */
export function dataIsoDoBcb(data: string): DataIso {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data.trim());
  if (!m) {
    throw new TypeError(`Data do BCB fora do formato esperado: ${data}`);
  }
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** `YYYY-MM-DD` => `dd/MM/yyyy`, o que a API do BCB espera em `dataInicial`/`dataFinal`. */
export function dataParaBcb(data: DataIso): string {
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano}`;
}
