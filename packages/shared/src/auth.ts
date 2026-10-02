/**
 * Contrato de autenticação (spec 01-fundacao-auth). `apps/web` ainda não existe, mas o shape fica
 * aqui desde já para o dia em que ele chegar consumir sem duplicar.
 */
export type ClienteSessao = 'web' | 'pwa';

export interface LoginRequest {
  email: string;
  senha: string;
  cliente?: ClienteSessao;
}

export interface Usuario {
  id: string;
  email: string;
}

export interface LoginResponse {
  accessToken: string;
  usuario: Usuario;
}

export interface RefreshResponse {
  accessToken: string;
}

export type AuthErrorCode = 'AUTH_CREDENCIAIS_INVALIDAS' | 'AUTH_SESSAO_INVALIDA';
