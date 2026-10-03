import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { type Request } from 'express';
import { type EnvironmentVariables } from '../../config/env.validation';
import { SYNC_TOKEN_HEADER } from './sync.constants';
import { SyncTokenInvalidoError } from './sync-errors';

function digest(valor: string): Buffer {
  return createHash('sha256').update(valor).digest();
}

/**
 * Protege `POST /sync` (ADR 0005): a chamada vem do cron externo, sem usuário. Compara os digests
 * SHA-256 (mesmo tamanho sempre) em tempo constante — não vaza nem o tamanho do segredo.
 */
@Injectable()
export class SyncTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const enviado = request.headers[SYNC_TOKEN_HEADER];
    const esperado = this.config.get('SYNC_CRON_TOKEN', { infer: true });

    if (
      typeof enviado !== 'string' ||
      !esperado ||
      !timingSafeEqual(digest(enviado), digest(esperado))
    ) {
      throw new SyncTokenInvalidoError();
    }
    return true;
  }
}
