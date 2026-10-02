import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * E-mail inexistente e senha errada dão o MESMO erro — não revela qual dos dois está errado
 * (spec 01-fundacao-auth, mesmo princípio mesmo com usuário único).
 */
export class CredenciaisInvalidasError extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.UNAUTHORIZED,
        code: 'AUTH_CREDENCIAIS_INVALIDAS',
        message: 'E-mail ou senha incorretos.',
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}

/** Cookie ausente, hash sem correspondência, revogado (reuso) ou vencido — todos o mesmo erro. */
export class SessaoInvalidaError extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.UNAUTHORIZED,
        code: 'AUTH_SESSAO_INVALIDA',
        message: 'Sessão inválida ou expirada.',
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
