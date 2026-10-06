import type {
  AvisoConexao,
  CodigoAvisoConexao,
  SeveridadeAviso,
  SituacaoConexao,
} from '@solidus/shared';
import {
  CONSENTIMENTO_ATENCAO_DIAS,
  CONSENTIMENTO_CRITICO_DIAS,
  DADOS_ATENCAO_DIAS,
  DADOS_CRITICO_DIAS,
  STATUS_QUE_PEDEM_O_USUARIO,
  SYNC_ATENCAO_DIAS,
  SYNC_CRITICO_DIAS,
} from './limites';

/** O que o último sync gravou sobre o item do Pluggy (só códigos e datas, nunca texto livre). */
export interface RetratoConexao {
  statusItem: string | null;
  consentimentoExpiraEm: Date | null;
  ultimaAtualizacaoEm: Date | null;
  autoSyncDesativadoEm: Date | null;
  acaoPendente: boolean;
  verificadoEm: Date | null;
  erroVerificacao: string | null;
}

export interface AvaliacaoConexao {
  situacao: SituacaoConexao;
  avisos: AvisoConexao[];
}

const DIA_MS = 24 * 60 * 60 * 1000;

function inicioDoDiaUtc(data: Date): number {
  return Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate());
}

/** Dias de calendário (UTC) de `de` até `ate`; negativo se `ate` é anterior. Só inteiros. */
function diasEntre(de: Date, ate: Date): number {
  return Math.round((inicioDoDiaUtc(ate) - inicioDoDiaUtc(de)) / DIA_MS);
}

const ORDEM_SEVERIDADE: Record<SeveridadeAviso, number> = { CRITICO: 0, ATENCAO: 1 };
const ORDEM_CODIGO: readonly CodigoAvisoConexao[] = [
  'CONSENTIMENTO_EXPIRADO',
  'CONSENTIMENTO_EXPIRA_EM_BREVE',
  'CONEXAO_PRECISA_DE_VOCE',
  'AUTO_SYNC_DESATIVADO',
  'ULTIMA_ATUALIZACAO_FALHOU',
  'DADOS_DESATUALIZADOS',
  'SYNC_DO_SOLIDUS_PARADO',
  'PLUGGY_INDISPONIVEL',
  'NUNCA_SINCRONIZADO',
];

function aviso(
  codigo: CodigoAvisoConexao,
  severidade: SeveridadeAviso,
  dias: number | null = null,
  acao: AvisoConexao['acao'] = null,
): AvisoConexao {
  return { codigo, severidade, acao, dias };
}

/** `maisDe`: há MAIS de N dias (estrito). Devolve a severidade ou `null` se está dentro do normal. */
function severidadePorAtraso(
  dias: number,
  atencaoMaisDe: number,
  criticoMaisDe: number,
): SeveridadeAviso | null {
  if (dias > criticoMaisDe) return 'CRITICO';
  if (dias > atencaoMaisDe) return 'ATENCAO';
  return null;
}

/**
 * Avalia o retrato da conexão (spec aviso-conexao-pluggy). Pura: o relógio vem de fora (`agora`), então o
 * teste é determinístico. A situação é a PIOR severidade; os avisos saem do mais grave ao menos grave.
 */
export function avaliarConexao(retrato: RetratoConexao | null, agora: Date): AvaliacaoConexao {
  if (retrato === null) {
    return { situacao: 'ATENCAO', avisos: [aviso('NUNCA_SINCRONIZADO', 'ATENCAO')] };
  }

  const avisos: AvisoConexao[] = [];
  const reautorizar = 'REAUTORIZAR_NO_MEU_PLUGGY' as const;

  // Consentimento: vencido (instante já passou) é o mais grave e dispensa o "expira em breve".
  if (retrato.consentimentoExpiraEm) {
    if (retrato.consentimentoExpiraEm.getTime() <= agora.getTime()) {
      avisos.push(aviso('CONSENTIMENTO_EXPIRADO', 'CRITICO', null, reautorizar));
    } else {
      const dias = diasEntre(agora, retrato.consentimentoExpiraEm);
      if (dias <= CONSENTIMENTO_CRITICO_DIAS) {
        avisos.push(aviso('CONSENTIMENTO_EXPIRA_EM_BREVE', 'CRITICO', dias, reautorizar));
      } else if (dias <= CONSENTIMENTO_ATENCAO_DIAS) {
        avisos.push(aviso('CONSENTIMENTO_EXPIRA_EM_BREVE', 'ATENCAO', dias, reautorizar));
      }
    }
  }

  // Estado do item. UPDATING e MERGING são "em andamento": não geram aviso.
  if (
    retrato.acaoPendente ||
    (retrato.statusItem !== null && STATUS_QUE_PEDEM_O_USUARIO.has(retrato.statusItem))
  ) {
    avisos.push(aviso('CONEXAO_PRECISA_DE_VOCE', 'CRITICO', null, reautorizar));
  } else if (retrato.statusItem === 'OUTDATED') {
    avisos.push(aviso('ULTIMA_ATUALIZACAO_FALHOU', 'ATENCAO'));
  }

  if (retrato.autoSyncDesativadoEm) {
    avisos.push(aviso('AUTO_SYNC_DESATIVADO', 'CRITICO'));
  }

  // Dado velho do lado do Pluggy. Sem nenhuma coleta registrada, o dado simplesmente não existe ainda.
  if (retrato.ultimaAtualizacaoEm) {
    const dias = diasEntre(retrato.ultimaAtualizacaoEm, agora);
    const severidade = severidadePorAtraso(dias, DADOS_ATENCAO_DIAS, DADOS_CRITICO_DIAS);
    if (severidade) avisos.push(aviso('DADOS_DESATUALIZADOS', severidade, dias));
  } else {
    avisos.push(aviso('DADOS_DESATUALIZADOS', 'ATENCAO'));
  }

  // O próprio Solidus parou de sincronizar (o agendador não roda): cobre a lacuna do cron.
  if (retrato.verificadoEm) {
    const dias = diasEntre(retrato.verificadoEm, agora);
    const severidade = severidadePorAtraso(dias, SYNC_ATENCAO_DIAS, SYNC_CRITICO_DIAS);
    if (severidade) {
      avisos.push(aviso('SYNC_DO_SOLIDUS_PARADO', severidade, dias, 'VERIFICAR_AGENDADOR_DO_SYNC'));
    }
  }

  if (retrato.erroVerificacao) {
    avisos.push(aviso('PLUGGY_INDISPONIVEL', 'ATENCAO'));
  }

  avisos.sort(
    (a, b) =>
      ORDEM_SEVERIDADE[a.severidade] - ORDEM_SEVERIDADE[b.severidade] ||
      ORDEM_CODIGO.indexOf(a.codigo) - ORDEM_CODIGO.indexOf(b.codigo),
  );

  const situacao: SituacaoConexao =
    avisos.length === 0 ? 'OK' : avisos[0]!.severidade === 'CRITICO' ? 'CRITICO' : 'ATENCAO';
  return { situacao, avisos };
}
