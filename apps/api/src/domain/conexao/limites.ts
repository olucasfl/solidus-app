/**
 * Limites do aviso de conexão do Pluggy (spec aviso-conexao-pluggy, "Suposições"). São constantes
 * nomeadas num lugar só: ajustar um limite é mudar uma linha, e os testes cobrem as bordas exatas.
 */

/** Consentimento: faltando até 30 dias avisa (ATENCAO); faltando até 7 vira CRITICO. */
export const CONSENTIMENTO_ATENCAO_DIAS = 30;
export const CONSENTIMENTO_CRITICO_DIAS = 7;

/**
 * Dado velho (o Pluggy atualiza uma vez por dia): "há MAIS de N dias". Exatamente 2 dias ainda é normal
 * (D+1 com folga); passar disso é atenção, e passar de 7 é crítico.
 */
export const DADOS_ATENCAO_DIAS = 2;
export const DADOS_CRITICO_DIAS = 7;

/** Mesma régua para o sync do próprio Solidus parado (o agendador não roda). */
export const SYNC_ATENCAO_DIAS = 2;
export const SYNC_CRITICO_DIAS = 7;

/** Status do Pluggy em que o usuário precisa agir (reconectar, autenticar, aprovar). */
export const STATUS_QUE_PEDEM_O_USUARIO: ReadonlySet<string> = new Set([
  'LOGIN_ERROR',
  'WAITING_USER_INPUT',
  'WAITING_USER_ACTION',
]);
