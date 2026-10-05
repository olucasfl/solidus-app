/** Contrato do sync com o Pluggy (spec 02-sync-pluggy). */
export interface SyncResponse {
  contas: number;
  transacoesNovas: number;
  transacoesAtualizadas: number;
  /** Transações em moeda estrangeira que o Pluggy não converteu para BRL. */
  semConversao: number;
  duracaoMs: number;
}

export type StatusSync = 'SUCESSO' | 'FALHA';

export interface SyncRunResumo {
  iniciadoEm: string;
  finalizadoEm: string | null;
  status: StatusSync;
  contas: number;
  transacoesNovas: number;
  transacoesAtualizadas: number;
}

export interface SyncStatusResponse {
  ultimoSync: SyncRunResumo | null;
}

export type SyncErrorCode =
  | 'SYNC_TOKEN_INVALIDO'
  | 'SYNC_EM_ANDAMENTO'
  | 'PLUGGY_INDISPONIVEL'
  | 'PLUGGY_NAO_CONFIGURADO'
  | 'SYNC_DONO_NAO_ENCONTRADO';
