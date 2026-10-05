import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';

// Recurso de outro usuário também cai nos 404: nunca 403 (não revela que existe — spec 06).
export class TransacaoNaoEncontradaError extends NotFoundException {
  constructor() {
    super({
      statusCode: 404,
      code: 'TRANSACAO_NAO_ENCONTRADA',
      message: 'Transação não encontrada.',
    });
  }
}

export class FonteNaoEncontradaError extends NotFoundException {
  constructor() {
    super({
      statusCode: 404,
      code: 'FONTE_NAO_ENCONTRADA',
      message: 'Fonte de renda não encontrada.',
    });
  }
}

/** A requisição é válida, mas o estado dos dados não permite a operação. */
class NaoProcessavelError extends HttpException {
  constructor(code: string, message: string) {
    super({ statusCode: 422, code, message }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class NaoEEntradaError extends NaoProcessavelError {
  constructor() {
    super('NAO_E_ENTRADA', 'Só uma entrada (dinheiro recebido) pode ser salário.');
  }
}

export class SemContraparteError extends NaoProcessavelError {
  constructor() {
    super(
      'SEM_CONTRAPARTE',
      'Essa transação não informa quem pagou, então não dá para criar uma fonte. Use uma regra por descrição (POST /regras).',
    );
  }
}

export class FonteNaoVigenteError extends NaoProcessavelError {
  constructor() {
    super('FONTE_NAO_VIGENTE', 'Só dá para trocar uma fonte de salário que ainda está vigente.');
  }
}

export class MesmaOrigemError extends NaoProcessavelError {
  constructor() {
    super('MESMA_ORIGEM', 'A transação escolhida é da mesma origem da fonte.');
  }
}

export class DataAnteriorAoInicioError extends NaoProcessavelError {
  constructor() {
    super(
      'DATA_ANTERIOR_AO_INICIO',
      'A transação escolhida é anterior ao início da fonte que está sendo trocada.',
    );
  }
}

export class FonteJaExisteError extends HttpException {
  constructor() {
    super(
      {
        statusCode: 409,
        code: 'FONTE_JA_EXISTE',
        message: 'Essa origem já é uma fonte de salário vigente.',
      },
      HttpStatus.CONFLICT,
    );
  }
}
