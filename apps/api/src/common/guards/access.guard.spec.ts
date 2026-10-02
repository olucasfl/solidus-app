import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessGuard } from './access.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

function mockContext(): ExecutionContext {
  return {
    getHandler: () => (() => undefined) as unknown as () => void,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe('AccessGuard', () => {
  it('nega a rota quando não é @Public()', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const guard = new AccessGuard(reflector);

    expect(() => guard.canActivate(mockContext())).toThrow(UnauthorizedException);
  });

  it('libera a rota quando é @Public()', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true),
    } as unknown as Reflector;
    const guard = new AccessGuard(reflector);

    expect(guard.canActivate(mockContext())).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, expect.any(Array));
  });
});
