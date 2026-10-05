/** Contrato de salário e fontes de renda (spec 07-salario-e-pix-automatico). Dinheiro em centavos. */
export type TipoFonteRenda = 'SALARIO' | 'RECORRENTE';
export type OrigemFonteRenda = 'MANUAL' | 'AUTOMATICA';

/** Nunca inclui a chave (hash do documento): só o que serve para exibir. */
export interface FonteDto {
  id: string;
  tipo: TipoFonteRenda;
  origem: OrigemFonteRenda;
  nome: string | null;
  docMascarado: string | null;
  /** `YYYY-MM-DD` (UTC). */
  vigenteDesde: string;
  /** `null` = sem fim. */
  vigenteAte: string | null;
  ativa: boolean;
}

export interface RecebimentoSalario {
  /** ISO 8601. */
  data: string;
  valorCentavos: number;
  /** `null` quando o salário veio de uma regra do usuário, sem fonte. */
  fonteId: string | null;
  transacaoId: string;
}

export interface SalarioResponse {
  fontesAtuais: FonteDto[];
  /** Soma do último recebimento de cada fonte vigente; `null` sem fonte vigente ou sem recebimento. */
  valorAtualCentavos: number | null;
  /** Mais recente primeiro. */
  historico: RecebimentoSalario[];
  /** Todas as fontes (vigentes e encerradas), do tipo SALARIO. */
  fontes: FonteDto[];
}

export interface DefinirFonteSalarioRequest {
  transacaoId: string;
}

export interface TrocarFonteSalarioRequest {
  transacaoId: string;
}

export interface TrocarFonteSalarioResponse {
  encerrada: FonteDto;
  nova: FonteDto;
}

export interface AtivarFonteRequest {
  ativa: boolean;
}
