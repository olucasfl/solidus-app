import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { type Request, type Response } from 'express';

/**
 * Filtro global: nunca deixa stack trace, corpo da request ou detalhe interno vazar na resposta.
 * Exceções HTTP conhecidas (`HttpException`, inclusive as do `ValidationPipe`) mantêm seu status e
 * corpo. Qualquer outro erro (bug, falha de infra) responde 500 genérico — o detalhe fica só no
 * log do servidor, nunca no corpo da resposta nem no log em si (RULES.md §8: nunca logar corpo de
 * request ou segredo).
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    this.logger.error(
      `${request.method} ${request.url} falhou com erro não tratado`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Erro interno',
    });
  }
}
