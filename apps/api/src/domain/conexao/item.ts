/**
 * O que o Solidus aproveita do item do Pluggy (spec aviso-conexao-pluggy). O domínio não importa o SDK:
 * recebe uma forma estrutural mínima. **Só códigos, datas e booleanos**: `error`, `statusDetail` e o conteúdo
 * de `userAction` podem carregar mensagem do banco ou link de autorização, então nem entram no tipo.
 */
export interface ItemPluggyBruto {
  status: string;
  executionStatus?: string | null;
  consentExpiresAt?: Date | string | null;
  lastUpdatedAt?: Date | string | null;
  nextAutoSyncAt?: Date | string | null;
  /** Existe na resposta real do Pluggy, mas o SDK 0.91 não o tipa. */
  autoSyncDisabledAt?: Date | string | null;
  consecutiveFailedLoginAttempts?: number | null;
  /** Só interessa SE existe; o conteúdo (URL, código) nunca é lido. */
  userAction?: unknown;
}

export interface ItemPluggy {
  statusItem: string;
  statusExecucao: string | null;
  consentimentoExpiraEm: Date | null;
  ultimaAtualizacaoEm: Date | null;
  proximaAtualizacaoEm: Date | null;
  autoSyncDesativadoEm: Date | null;
  falhasDeLogin: number | null;
  acaoPendente: boolean;
}

function paraData(valor: Date | string | null | undefined): Date | null {
  if (valor === null || valor === undefined) return null;
  const data = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

export function mapearItem(bruto: ItemPluggyBruto): ItemPluggy {
  return {
    statusItem: bruto.status.slice(0, 40),
    statusExecucao: bruto.executionStatus ? bruto.executionStatus.slice(0, 40) : null,
    consentimentoExpiraEm: paraData(bruto.consentExpiresAt),
    ultimaAtualizacaoEm: paraData(bruto.lastUpdatedAt),
    proximaAtualizacaoEm: paraData(bruto.nextAutoSyncAt),
    autoSyncDesativadoEm: paraData(bruto.autoSyncDisabledAt),
    falhasDeLogin:
      typeof bruto.consecutiveFailedLoginAttempts === 'number'
        ? bruto.consecutiveFailedLoginAttempts
        : null,
    acaoPendente: bruto.userAction !== null && bruto.userAction !== undefined,
  };
}
