/** Contrato da carteira por Caixinha (spec 05-carteira-caixinhas). Dinheiro em centavos inteiros. */
export type TipoMovimentoCaixinha = 'SALDO' | 'APORTE' | 'RESGATE';

export type AvisoCarteira =
  'SEM_SALDO_INFORMADO' | 'CDI_DEFASADO' | 'IMPOSTO_NAO_CONFIGURADO' | 'RESGATE_ACIMA_DO_SALDO';

/** Ordem, no mesmo dia, entre aporte/resgate e o rendimento do CDI (ver spec 05). */
export type ConvencaoRendimento =
  'MOVIMENTO_ANTES_DO_RENDIMENTO' | 'MOVIMENTO_DEPOIS_DO_RENDIMENTO';

export interface Caixinha {
  id: string;
  nome: string;
  /** 11500 = 115% do CDI; 0 = não rende. */
  percentualCdiBp: number;
  /** Conta no patrimônio, mas é verba para gastar no mês (não é "investido"). */
  reservaDeGastos: boolean;
  /** Faz parte da reserva de EMERGÊNCIA (não confundir com `reservaDeGastos`). Spec reserva-emergencia. */
  reservaEmergencia: boolean;
  /** `null` = convenção padrão do app. */
  convencaoRendimento: ConvencaoRendimento | null;
  ativa: boolean;
}

export interface CriarCaixinhaRequest {
  nome: string;
  percentualCdiBp: number;
  reservaDeGastos?: boolean;
  reservaEmergencia?: boolean;
  convencaoRendimento?: ConvencaoRendimento;
}

export interface AtualizarCaixinhaRequest {
  nome?: string;
  percentualCdiBp?: number;
  reservaDeGastos?: boolean;
  reservaEmergencia?: boolean;
  /** `null` volta para a convenção padrão. */
  convencaoRendimento?: ConvencaoRendimento | null;
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
  reservaEmergencia: boolean;
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

export interface ComparacaoSaldo {
  /** SALDO anterior (de onde a estimativa parte) e SALDO seguinte (o que o usuário informou). */
  de: string;
  ate: string;
  informadoCentavos: number;
  estimadoCentavos: number;
  /** informado − estimado: positivo = o banco pagou mais do que o app estimou. */
  diferencaCentavos: number;
}

export interface ConferenciaPorConvencao {
  convencao: ConvencaoRendimento;
  comparacoes: ComparacaoSaldo[];
  erroAbsolutoTotalCentavos: number;
}

/** O app se confere com os saldos que o usuário já informou: sem trabalho extra. */
export interface ConferenciaCaixinha {
  caixinhaId: string;
  convencaoEmUso: ConvencaoRendimento;
  porConvencao: ConferenciaPorConvencao[];
  /** A que erra menos; `null` se ainda não há dois saldos ou os saldos não distinguem as duas. */
  convencaoSugerida: ConvencaoRendimento | null;
}
