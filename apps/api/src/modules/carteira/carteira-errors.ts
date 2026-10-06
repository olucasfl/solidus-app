import { BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';

/** Dinheiro para gastar no mês e reserva de emergência são opostos: uma Caixinha não pode ser os dois. */
export class CaixinhaReservasIncompativeisError extends BadRequestException {
  constructor() {
    super({
      statusCode: 400,
      code: 'CAIXINHA_RESERVAS_INCOMPATIVEIS',
      message:
        'Uma Caixinha não pode ser reserva de gastos e reserva de emergência ao mesmo tempo.',
    });
  }
}

export class CaixinhaNaoEncontradaError extends NotFoundException {
  constructor() {
    super({
      statusCode: 404,
      code: 'CAIXINHA_NAO_ENCONTRADA',
      message: 'Caixinha não encontrada.',
    });
  }
}

export class MovimentoNaoEncontradoError extends NotFoundException {
  constructor() {
    super({
      statusCode: 404,
      code: 'MOVIMENTO_NAO_ENCONTRADO',
      message: 'Movimento não encontrado.',
    });
  }
}

export class TransacaoJaVinculadaError extends HttpException {
  constructor() {
    super(
      {
        statusCode: 409,
        code: 'TRANSACAO_JA_VINCULADA',
        message: 'Essa transação já está vinculada a um movimento.',
      },
      HttpStatus.CONFLICT,
    );
  }
}

/** Transação inexistente, de outra categoria, ou cujo sentido não bate com o tipo do movimento. */
export class TransacaoInvalidaError extends HttpException {
  constructor(motivo: string) {
    super(
      { statusCode: 422, code: 'TRANSACAO_INVALIDA', message: motivo },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** Mensagem genérica de propósito: o erro original do BCB nunca vai para a resposta. */
export class CdiIndisponivelError extends HttpException {
  constructor() {
    super(
      {
        statusCode: 502,
        code: 'CDI_INDISPONIVEL',
        message: 'Banco Central indisponível no momento.',
      },
      HttpStatus.BAD_GATEWAY,
    );
  }
}

export function dadoInvalido(code: string, message: string, extra?: object): BadRequestException {
  return new BadRequestException({ statusCode: 400, code, message, ...extra });
}
