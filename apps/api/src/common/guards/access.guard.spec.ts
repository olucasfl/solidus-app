import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AccessGuard } from './access.guard';
import { type EnvironmentVariables } from '../../config/env.validation';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

function mockContext(authorization?: string): ExecutionContext {
  return {
    getHandler: () => (() => undefined) as unknown as () => void,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as unknown as ExecutionContext;
}

describe('AccessGuard', () => {
  function build(isPublic: boolean | undefined, jwtService: Partial<JwtService>) {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(isPublic),
    } as unknown as Reflector;
    const configService = {
      get: jest.fn().mockReturnValue('segredo-de-teste-com-32-caracteres'),
    } as unknown as ConfigService<EnvironmentVariables, true>;

    return new AccessGuard(reflector, jwtService as JwtService, configService);
  }

  it('libera a rota quando é @Public(), sem olhar o token', async () => {
    const jwtService = { verifyAsync: jest.fn() };
    const guard = build(true, jwtService);

    await expect(guard.canActivate(mockContext())).resolves.toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('nega quando não é @Public() e não há Authorization', async () => {
    const guard = build(undefined, { verifyAsync: jest.fn() });

    await expect(guard.canActivate(mockContext())).rejects.toThrow(UnauthorizedException);
  });

  it('nega quando o Authorization não é Bearer', async () => {
    const guard = build(undefined, { verifyAsync: jest.fn() });

    await expect(guard.canActivate(mockContext('Token abc'))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('libera e anexa o payload em request.user quando o token é válido', async () => {
    const verifyAsync = jest.fn().mockResolvedValue({ sub: 'user-1' });
    const guard = build(undefined, { verifyAsync });
    const context = mockContext('Bearer token-valido');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyAsync).toHaveBeenCalledWith(
      'token-valido',
      expect.objectContaining({ secret: expect.any(String) }),
    );
  });

  it('nega quando o token é inválido ou expirado (verifyAsync rejeita)', async () => {
    const verifyAsync = jest.fn().mockRejectedValue(new Error('jwt expired'));
    const guard = build(undefined, { verifyAsync });

    await expect(guard.canActivate(mockContext('Bearer token-expirado'))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('usa a mesma chave de metadata (@Public()) que o decorator exporta', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true),
    } as unknown as Reflector;
    const guard = new AccessGuard(
      reflector,
      { verifyAsync: jest.fn() } as unknown as JwtService,
      { get: jest.fn() } as unknown as ConfigService<EnvironmentVariables, true>,
    );

    await guard.canActivate(mockContext());

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, expect.any(Array));
  });
});
