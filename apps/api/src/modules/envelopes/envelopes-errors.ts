import { ConflictException, NotFoundException } from '@nestjs/common';

// Envelope de outro usuário também cai aqui: 404, nunca 403 (não revela que existe — spec 06).
export class EnvelopeNaoEncontradoError extends NotFoundException {
  constructor() {
    super({
      statusCode: 404,
      code: 'ENVELOPE_NAO_ENCONTRADO',
      message: 'Envelope não encontrado.',
    });
  }
}

export class EnvelopeJaExisteError extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      code: 'ENVELOPE_JA_EXISTE',
      message: 'Você já tem um envelope com esse nome.',
    });
  }
}
