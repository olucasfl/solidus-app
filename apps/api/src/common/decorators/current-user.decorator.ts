import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { type Request } from 'express';
import { type AccessTokenPayload } from '../guards/access.guard';

/** O payload que `AccessGuard` já verificou e anexou em `request.user` (RULES.md: nunca confiar
 * em dado não validado — por isso isto só lê o que o guard global já checou, não decodifica de novo). */
export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): AccessTokenPayload => {
    const request = context.switchToHttp().getRequest<Request>();
    return request.user as AccessTokenPayload;
  },
);
