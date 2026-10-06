/**
 * Contrato dos envelopes virtuais (spec envelopes). Dinheiro em CENTAVOS inteiros; nenhum float.
 * Um envelope é uma divisão VIRTUAL do dinheiro (para que ele serve), independente das Caixinhas (onde ele está).
 * O Solidus é somente leitura: um envelope não move nem altera dinheiro nenhum.
 */
export type AvisoEnvelopes =
  | 'ALOCADO_ACIMA_DO_DISPONIVEL'
  | 'FATURA_DO_CARTAO_NAO_DESCONTADA'
  | 'SEM_CONTA_SINCRONIZADA'
  | 'CDI_DEFASADO'
  | 'SEM_SALDO_INFORMADO'
  | 'IMPOSTO_NAO_CONFIGURADO';

export interface Envelope {
  id: string;
  nome: string;
  /** O que o usuário reservou neste envelope (≥ 0). */
  alocadoCentavos: number;
  metaCentavos: number | null;
  /** Centésimos de percentual: 5000 = 50%. `null` sem meta; pode passar de 10000. */
  progressoBp: number | null;
  /** `null` sem meta. */
  faltaCentavos: number | null;
  /** `false` sem meta. */
  atingida: boolean;
}

export interface CriarEnvelopeRequest {
  nome: string;
  alocadoCentavos?: number;
  metaCentavos?: number | null;
}

/** Edição parcial; `metaCentavos: null` REMOVE a meta (nos outros campos `null` é inválido). */
export interface AtualizarEnvelopeRequest {
  nome?: string;
  alocadoCentavos?: number;
  metaCentavos?: number | null;
}

export interface EnvelopesResponse {
  disponivel: {
    /** Soma do valor realizável (líquido estimado; bruto se o imposto não está configurado) das Caixinhas ativas. */
    caixinhasCentavos: number;
    /** Soma dos saldos das contas CORRENTE e POUPANCA do sync (o cartão nunca entra). */
    contaCorrenteCentavos: number;
    totalCentavos: number;
  };
  /** Envelope AUTOMÁTICO e somente leitura: o valor realizável das Caixinhas marcadas como reserva de emergência. */
  reserva: {
    valorCentavos: number;
    metaCentavos: number;
    /** `max(0, valor − meta)` quando há meta; informativo. */
    excedenteCentavos: number;
  };
  /** Por data de criação. */
  envelopes: Envelope[];
  totalAlocadoCentavos: number;
  /** `total − reserva − totalAlocado`. Pode ser NEGATIVO (o app avisa, não recusa). */
  livreCentavos: number;
  avisos: AvisoEnvelopes[];
  /** Data de referência do saldo, `YYYY-MM-DD` (UTC). */
  data: string;
}
