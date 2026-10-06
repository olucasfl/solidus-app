/**
 * Contrato do aviso de conexão do Pluggy (spec aviso-conexao-pluggy). O app só LÊ o estado do item e
 * avisa; reautorizar é com o usuário, no meu.pluggy.ai (o Solidus é somente leitura).
 */
export type SituacaoConexao = 'OK' | 'ATENCAO' | 'CRITICO';
export type SeveridadeAviso = 'ATENCAO' | 'CRITICO';

export type CodigoAvisoConexao =
  | 'CONSENTIMENTO_EXPIRADO'
  | 'CONSENTIMENTO_EXPIRA_EM_BREVE'
  | 'CONEXAO_PRECISA_DE_VOCE'
  | 'ULTIMA_ATUALIZACAO_FALHOU'
  | 'AUTO_SYNC_DESATIVADO'
  | 'DADOS_DESATUALIZADOS'
  | 'SYNC_DO_SOLIDUS_PARADO'
  | 'PLUGGY_INDISPONIVEL'
  | 'NUNCA_SINCRONIZADO';

export type AcaoSugerida = 'REAUTORIZAR_NO_MEU_PLUGGY' | 'VERIFICAR_AGENDADOR_DO_SYNC' | null;

export interface AvisoConexao {
  codigo: CodigoAvisoConexao;
  severidade: SeveridadeAviso;
  acao: AcaoSugerida;
  /** Dias inteiros que dão contexto (dias para expirar, dias sem atualizar); `null` quando não se aplica. */
  dias: number | null;
}

export interface ConexaoResponse {
  situacao: SituacaoConexao;
  /** Do mais grave para o menos grave. */
  avisos: AvisoConexao[];
  /** `null` enquanto nenhum sync leu o item. Nunca inclui o `itemId`. */
  conexao: {
    /** Status do Pluggy (ex.: UPDATED, LOGIN_ERROR). */
    status: string | null;
    /** ISO 8601. */
    consentimentoExpiraEm: string | null;
    /** `lastUpdatedAt` do Pluggy, ISO 8601. */
    ultimaAtualizacaoEm: string | null;
    /** Última leitura bem-sucedida do item pelo Solidus, ISO 8601. */
    verificadoEm: string | null;
  } | null;
  /** O "agora" da avaliação, ISO 8601. */
  calculadoEm: string;
}
