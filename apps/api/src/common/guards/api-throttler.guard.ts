import { type ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';

/**
 * Mesmo ThrottlerGuard do @nestjs/throttler, só com o corpo do erro no formato do projeto
 * (`code` + `message`, igual todo outro erro — `GlobalExceptionFilter` repassa o corpo de
 * qualquer `HttpException` como está). Substitui o `ThrottlerGuard` puro como guard global
 * (`app.module.ts`) para toda rota throttled ter o mesmo formato, não só `/auth/login`.
 */
@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  protected override async throwThrottlingException(
    _context: ExecutionContext,
    _throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'LIMITE_TENTATIVAS',
        message: 'Muitas tentativas. Aguarde um minuto.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
