import type { CategoriaId, NaturezaCategoria } from './categoria';

/** Contrato da taxa de poupança (spec 04-taxa-de-poupanca). Dinheiro em centavos inteiros. */
export type AvisoPoupanca =
  'SEM_TRANSACOES' | 'SEM_RECEITA' | 'ENTRADAS_A_CLASSIFICAR' | 'PIX_ENTRE_PESSOAS_FORA_DA_CONTA';

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
  /**
   * Pix/transferências de e para pessoas: fora da conta por padrão (nem renda nem despesa), mas
   * nunca escondidos. Para contá-los, o usuário cria uma regra de categoria (aluguel, cliente...).
   */
  pixPessoas: { quantidade: number; entradasCentavos: number; saidasCentavos: number };
  porCategoria: PoupancaCategoria[];
  avisos: AvisoPoupanca[];
}

export interface HistoricoPoupancaResponse {
  meses: PoupancaMes[];
}
