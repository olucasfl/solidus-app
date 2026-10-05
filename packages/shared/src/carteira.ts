/** Contrato da carteira por Caixinha (spec 05-carteira-caixinhas). Dinheiro em centavos inteiros. */
export type TipoMovimentoCaixinha = 'SALDO' | 'APORTE' | 'RESGATE';

export type AvisoCarteira =
  'SEM_SALDO_INFORMADO' | 'CDI_DEFASADO' | 'IMPOSTO_NAO_CONFIGURADO' | 'RESGATE_ACIMA_DO_SALDO';

export interface Caixinha {
  id: string;
  nome: string;
  /** 11500 = 115% do CDI; 0 = não rende. */
  percentualCdiBp: number;
  /** Conta no patrimônio, mas é verba para gastar no mês (não é "investido"). */
  reservaDeGastos: boolean;
  ativa: boolean;
}

export interface CriarCaixinhaRequest {
  nome: string;
  percentualCdiBp: number;
  reservaDeGastos?: boolean;
}

export interface AtualizarCaixinhaRequest {
  nome?: string;
  percentualCdiBp?: number;
  reservaDeGastos?: boolean;
  ativa?: boolean;
}

export interface MovimentoCaixinha {
  id: string;
  caixinhaId: string;
  tipo: TipoMovimentoCaixinha;
  /** `YYYY-MM-DD`. */
  data: string;
  valorCentavos: number;
  /** Só SALDO: desde quando o dinheiro já estava aplicado. */
  dataOrigem: string | null;
  /** Transação do sync a que o movimento está vinculado. */
  transacaoId: string | null;
}

export interface CriarMovimentoRequest {
  tipo: TipoMovimentoCaixinha;
  data: string;
  /** Opcional só quando há `transacaoId` (assume o módulo da transação). */
  valorCentavos?: number;
  dataOrigem?: string;
  transacaoId?: string;
}

export interface SugestaoMovimento {
  transacaoId: string;
  data: string;
  descricao: string;
  valorCentavos: number;
  tipo: 'DEBITO' | 'CREDITO';
  /** DEBITO (saiu da conta) = APORTE; CREDITO (voltou para a conta) = RESGATE. */
  sugestao: 'APORTE' | 'RESGATE';
}

export type TipoImposto = 'IR' | 'IOF';

/** `ateDias: null` = sem limite (só a última faixa). Alíquota em pontos-base (2250 = 22,5%). */
export interface FaixaImposto {
  ateDias: number | null;
  aliquotaBp: number;
}

export interface ImpostosResponse {
  IR: FaixaImposto[];
  IOF: FaixaImposto[];
}

export interface SubstituirImpostosRequest {
  faixas: FaixaImposto[];
}

export interface CaixinhaNaCarteira {
  id: string;
  nome: string;
  percentualCdiBp: number;
  reservaDeGastos: boolean;
  ativa: boolean;
  saldoInformado: { data: string; centavos: number } | null;
  saldoBrutoEstimadoCentavos: number;
  rendimentoBrutoCentavos: number;
  impostos: { iofCentavos: number; irCentavos: number } | null;
  saldoLiquidoEstimadoCentavos: number | null;
  rendimentoLiquidoCentavos: number | null;
  avisos: AvisoCarteira[];
}

export interface Carteira {
  /** Data de referência, `YYYY-MM-DD`. */
  data: string;
  caixinhas: CaixinhaNaCarteira[];
  totais: {
    patrimonioCentavos: number;
    investidoCentavos: number;
    disponivelParaGastarCentavos: number;
  };
  avisos: AvisoCarteira[];
}

export interface CdiSyncResponse {
  /** Dias de CDI devolvidos pelo Banco Central. */
  dias: number;
  /** Quantos eram novos (os demais já estavam gravados). */
  novos: number;
}

export type CarteiraErrorCode =
  | 'CAIXINHA_NAO_ENCONTRADA'
  | 'MOVIMENTO_NAO_ENCONTRADO'
  | 'TRANSACAO_JA_VINCULADA'
  | 'TRANSACAO_INVALIDA'
  | 'CDI_INDISPONIVEL';
