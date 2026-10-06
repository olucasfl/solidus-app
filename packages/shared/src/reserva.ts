/**
 * Contrato da reserva de emergência (spec reserva-emergencia). Dinheiro em CENTAVOS inteiros; nenhum float.
 * Não confundir com `Caixinha.reservaDeGastos` (spec 05): aquela é dinheiro para GASTAR no mês.
 */
export type BaseGastoReserva = 'BRUTA' | 'LIQUIDA';

export type AvisoReserva =
  | 'NENHUMA_CAIXINHA_MARCADA'
  | 'SEM_GASTOS_NA_JANELA'
  | 'HISTORICO_CURTO'
  | 'IMPOSTO_NAO_CONFIGURADO'
  | 'CDI_DEFASADO'
  | 'SEM_SALDO_INFORMADO';

export interface ConfiguracaoReserva {
  /** Quantos meses de gasto a reserva deve cobrir (1 a 60). */
  meses: number;
  /** Base do gasto mensal usada na meta. */
  base: BaseGastoReserva;
  /** Quantos meses FECHADOS entram na média (1 a 24). */
  janelaMeses: number;
}

export type AtualizarConfiguracaoReservaRequest = Partial<ConfiguracaoReserva>;

export interface MesDeGastoReserva {
  /** `YYYY-MM` (calendário em UTC). */
  mes: string;
  /** Despesa SEM creditar o Pix recebido de pessoas. */
  brutoCentavos: number;
  /** Despesa da taxa de poupança (Pix recebido abate despesa). */
  liquidoCentavos: number;
}

export interface CaixinhaDaReserva {
  id: string;
  nome: string;
  saldoCentavos: number;
  baseDoSaldo: 'LIQUIDO_ESTIMADO' | 'BRUTO_ESTIMADO';
}

export interface ReservaEmergenciaResponse {
  configuracao: ConfiguracaoReserva;
  gasto: {
    /** A base usada na meta. */
    base: BaseGastoReserva;
    /** Do mais antigo ao mais recente; só os meses que entraram na média. */
    meses: MesDeGastoReserva[];
    mediaMensalBrutaCentavos: number;
    mediaMensalLiquidaCentavos: number;
    /** A média da base configurada. */
    mediaMensalCentavos: number;
  };
  metaCentavos: number;
  reserva: {
    saldoCentavos: number;
    caixinhas: CaixinhaDaReserva[];
  };
  faltaCentavos: number;
  /** Centésimos de mês: 450 = 4,50 meses. `null` quando não há gasto para comparar. */
  coberturaMesesCentesimos: number | null;
  atingida: boolean;
  avisos: AvisoReserva[];
  /** Data de referência do saldo, `YYYY-MM-DD` (UTC). */
  data: string;
}
