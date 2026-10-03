import { type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type EnvironmentVariables } from '../../config/env.validation';
import { SyncTokenGuard } from './sync-token.guard';
import { SyncTokenInvalidoError } from './sync-errors';

const SEGREDO = 'a'.repeat(64);

function contexto(header?: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-sync-token': header } }) }),
  } as unknown as ExecutionContext;
}

function guard(esperado: string | undefined = SEGREDO): SyncTokenGuard {
  const config = { get: jest.fn().mockReturnValue(esperado) };
  return new SyncTokenGuard(config as unknown as ConfigService<EnvironmentVariables, true>);
}

describe('SyncTokenGuard', () => {
  it('libera com o token certo', () => {
    expect(guard().canActivate(contexto(SEGREDO))).toBe(true);
  });

  it('CA-09: nega sem header, com tamanho errado e com mesmo tamanho porém errado', () => {
    expect(() => guard().canActivate(contexto(undefined))).toThrow(SyncTokenInvalidoError);
    expect(() => guard().canActivate(contexto('curto'))).toThrow(SyncTokenInvalidoError);
    expect(() => guard().canActivate(contexto('b'.repeat(64)))).toThrow(SyncTokenInvalidoError);
  });

  it('nega header que não é string (repetido)', () => {
    expect(() => guard().canActivate(contexto([SEGREDO, SEGREDO]))).toThrow(SyncTokenInvalidoError);
  });

  it('nega tudo se o segredo não estiver configurado', () => {
    expect(() => guard('').canActivate(contexto(''))).toThrow(SyncTokenInvalidoError);
  });
});
