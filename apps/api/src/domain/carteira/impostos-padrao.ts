import { type FaixaImposto } from './projetar';

/**
 * SEMENTE das tabelas de imposto — dados, não regra: o `db:seed` só as grava se a tabela do tipo
 * estiver vazia, e depois o usuário as edita por `PUT /impostos/:tipo`. O cálculo nunca lê estas
 * constantes, só as linhas do banco. São a tabela legal de renda fixa que o agente conhece; quem
 * confere é o humano (spec 05, "Para o humano verificar").
 */

/** IR regressivo de renda fixa, por idade do lote: 22,5% / 20% / 17,5% / 15%. */
export const IR_PADRAO: readonly FaixaImposto[] = [
  { ateDias: 180, aliquotaBp: 2250 },
  { ateDias: 360, aliquotaBp: 2000 },
  { ateDias: 720, aliquotaBp: 1750 },
  { ateDias: null, aliquotaBp: 1500 },
];

/** IOF regressivo sobre o rendimento: 96% no dia 1, caindo até 3% no dia 29; a partir do dia 30, 0. */
const IOF_POR_DIA = [
  96, 93, 90, 86, 83, 80, 76, 73, 70, 66, 63, 60, 56, 53, 50, 46, 43, 40, 36, 33, 30, 26, 23, 20,
  16, 13, 10, 6, 3,
];

export const IOF_PADRAO: readonly FaixaImposto[] = [
  ...IOF_POR_DIA.map((pct, i) => ({ ateDias: i + 1, aliquotaBp: pct * 100 })),
  { ateDias: null, aliquotaBp: 0 },
];
