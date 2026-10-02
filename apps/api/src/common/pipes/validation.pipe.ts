import { ValidationPipe } from '@nestjs/common';

/**
 * ValidationPipe global. `whitelist + forbidNonWhitelisted`: um campo sem decorator no DTO
 * simplesmente não existe para a API — adicionar um campo novo a uma rota exige adicioná-lo ao
 * DTO, não só ao controller. Fica numa função para o `main.ts` e os testes usarem exatamente as
 * mesmas opções.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
}
