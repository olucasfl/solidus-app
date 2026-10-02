import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { type Request } from 'express';
import { type EnvironmentVariables } from '../../config/env.validation';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/** Payload do access token (JWT). `sub` é o id do usuário — só existe um, mas o shape é o padrão. */
export interface AccessTokenPayload {
  sub: string;
}

declare module 'express' {
  interface Request {
    user?: AccessTokenPayload;
  }
}

/**
 * Guard global (`APP_GUARD`): nega toda rota por padrão, exceto as marcadas com `@Public()`. A
 * partir da spec 01-fundacao-auth, rota não-pública exige `Authorization: Bearer <accessToken>` —
 * um JWT válido (assinatura + `exp`) assinado com `JWT_ACCESS_SECRET`. Verificação é stateless (só
 * o refresh, de vida mais longa, é validado contra o banco — `auth.service.ts`).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException();
    }

    try {
      request.user = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.configService.get('JWT_ACCESS_SECRET', { infer: true }),
      });
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}

function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return undefined;
  }
  return header.slice('Bearer '.length);
}
