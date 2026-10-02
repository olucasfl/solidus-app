import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Libera a rota (ou o controller inteiro) do guard global de autenticação. Sem ele, toda rota
 * responde 401 — esquecer o decorator fecha a rota, nunca a abre. Use só com justificativa na
 * spec (RULES.md): hoje, só `GET /health`.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
