import { HttpException, HttpStatus } from '@nestjs/common';

function erro(status: HttpStatus, code: string, message: string): HttpException {
  return new HttpException({ statusCode: status, code, message }, status);
}

/** Header ausente, de tamanho errado ou com valor errado: sempre o mesmo erro. */
export class SyncTokenInvalidoError extends HttpException {
  constructor() {
    const e = erro(HttpStatus.UNAUTHORIZED, 'SYNC_TOKEN_INVALIDO', 'Token de sync inválido.');
    super(e.getResponse(), e.getStatus());
  }
}

export class SyncEmAndamentoError extends HttpException {
  constructor() {
    const e = erro(HttpStatus.CONFLICT, 'SYNC_EM_ANDAMENTO', 'Já existe um sync em andamento.');
    super(e.getResponse(), e.getStatus());
  }
}

/** Mensagem genérica de propósito: o erro original do Pluggy nunca vai para a resposta. */
export class PluggyIndisponivelError extends HttpException {
  constructor() {
    const e = erro(
      HttpStatus.BAD_GATEWAY,
      'PLUGGY_INDISPONIVEL',
      'Pluggy indisponível no momento.',
    );
    super(e.getResponse(), e.getStatus());
  }
}

export class PluggyNaoConfiguradoError extends HttpException {
  constructor() {
    const e = erro(
      HttpStatus.SERVICE_UNAVAILABLE,
      'PLUGGY_NAO_CONFIGURADO',
      'Integração com o Pluggy não configurada.',
    );
    super(e.getResponse(), e.getStatus());
  }
}
