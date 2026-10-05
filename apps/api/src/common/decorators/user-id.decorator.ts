import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { type Request } from 'express';

/**
 * O id do usuário da SESSÃO (o `sub` do access token que o `AccessGuard` já verificou). É a única
 * fonte válida de `userId` nas rotas (spec 06): nunca de body, query ou param. Sem usuário verificado
 * (rota `@Public()` usada por engano) nega em vez de seguir sem dono.
 */
export const UserId = createParamDecorator((_: unknown, context: ExecutionContext): string => {
  const userId = context.switchToHttp().getRequest<Request>().user?.sub;
  if (!userId) {
    throw new UnauthorizedException();
  }
  return userId;
});
