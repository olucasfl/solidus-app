import type { CategoriaId, NaturezaCategoria } from './categoria';

/** Contrato da taxa de poupança (spec 04-taxa-de-poupanca). Dinheiro em centavos inteiros. */
export type AvisoPoupanca = 'SEM_TRANSACOES' | 'SEM_RECEITA' | 'ENTRADAS_A_CLASSIFICAR';

/** Categoria que só existe no cálculo da poupança (spec 07): o líquido dos Pix entre pessoas. */
export const PIX_ENTRE_PESSOAS_LIQUIDO = 'PIX_ENTRE_PESSOAS_LIQUIDO';

export interface PoupancaCategoria {
  categoria: CategoriaId | 'SEM_CATEGORIA' | typeof PIX_ENTRE_PESSOAS_LIQUIDO;
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
   * Pix de e para pessoas que não são renda (spec 07): contam pelo LÍQUIDO do mês (saídas − entradas).
   * Saiu mais do que entrou → a diferença é despesa; entrou mais → abate despesa (reembolso), até o
   * limite das despesas, e nunca vira receita. `abatimentoCentavos` é quanto foi realmente abatido.
   */
  pixPessoas: {
    quantidade: number;
    entradasCentavos: number;
    saidasCentavos: number;
    liquidoCentavos: number;
    abatimentoCentavos: number;
  };
  porCategoria: PoupancaCategoria[];
  avisos: AvisoPoupanca[];
}

export interface HistoricoPoupancaResponse {
  meses: PoupancaMes[];
}
