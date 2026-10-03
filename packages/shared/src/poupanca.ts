import type { CategoriaId, NaturezaCategoria } from './categoria';

/** Contrato da taxa de poupança (spec 04-taxa-de-poupanca). Dinheiro em centavos inteiros. */
export type AvisoPoupanca = 'SEM_TRANSACOES' | 'SEM_RECEITA' | 'ENTRADAS_A_CLASSIFICAR';

export interface PoupancaCategoria {
  categoria: CategoriaId | 'SEM_CATEGORIA';
  natureza: NaturezaCategoria;
  quantidade: number;
  /** Assinado, como gravado: saída negativa, entrada positiva. */
  totalCentavos: number;
}

export interface PoupancaMes {
  /** `YYYY-MM` (calendário em UTC). */
  mes: string;
  receitasCentavos: number;
  despesasCentavos: number;
  poupancaCentavos: number;
  /** Pontos-base inteiros (1534 = 15,34%); `null` quando não há receita no mês. */
  taxaBasisPoints: number | null;
  transacoes: number;
  neutras: { quantidade: number };
  indefinidas: { quantidade: number; entradasCentavos: number; saidasCentavos: number };
  porCategoria: PoupancaCategoria[];
  avisos: AvisoPoupanca[];
}

export interface HistoricoPoupancaResponse {
  meses: PoupancaMes[];
}
