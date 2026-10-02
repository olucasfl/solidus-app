/** 15 min — igual para `web` e `pwa` (só o refresh varia por cliente, spec 01-fundacao-auth). */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** Refresh `web` expira em 7 dias. Refresh `pwa` não tem TTL — `expiraEm: null` no banco. */
export const REFRESH_TOKEN_TTL_WEB_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * `Max-Age` do cookie quando a sessão é `pwa` (o banco não tem TTL pra essa sessão, mas o cookie
 * em si precisa de uma validade pra sobreviver a reaberturas do app — sem isso viraria um cookie
 * de sessão, apagado quando o app fosse encerrado). 10 anos = na prática, não expira.
 */
export const REFRESH_COOKIE_MAX_AGE_PWA_MS = 10 * 365 * 24 * 60 * 60 * 1000;

export const REFRESH_TOKEN_COOKIE_NAME = 'solidus_refresh';

/** Tentativas de login por IP (`ApiThrottlerGuard`, via `@Throttle()` na rota). */
export const LOGIN_THROTTLE_LIMIT = 5;
export const LOGIN_THROTTLE_TTL_MS = 60_000;
