import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Guard global (`APP_GUARD`): nega toda rota por padrão, exceto as marcadas com `@Public()`.
 * A verificação real do access token (JWT, sessão) entra na spec 01-fundacao-auth — até lá, este
 * guard nega mesmo com um "token" presente no header, de propósito: "seguro por padrão" não pode
 * depender de uma verificação que ainda não existe.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    throw new UnauthorizedException();
  }
}
