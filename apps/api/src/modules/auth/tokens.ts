import { createHash, randomBytes } from 'node:crypto';

const REFRESH_TOKEN_BYTES = 32;

/** Token puro do refresh — só existe no cookie do cliente, nunca é gravado (ver `hashRefreshToken`). */
export function gerarRefreshTokenBruto(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
}

/** Hash SHA-256 (hex, 64 chars) do token puro — é só isto que vai para `RefreshSession.tokenHash`. */
export function hashRefreshToken(tokenBruto: string): string {
  return createHash('sha256').update(tokenBruto).digest('hex');
}
