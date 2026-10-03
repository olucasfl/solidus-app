import { type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { createValidationPipe } from './common/pipes/validation.pipe';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { type EnvironmentVariables } from './config/env.validation';

/**
 * Tudo o que o `main.ts` liga na aplicação, à parte para os testes e a verificação manual subirem
 * a MESMA configuração (helmet, CORS, pipe, filtro de erro) em vez de uma cópia que pode divergir.
 */
export function setupApp(app: INestApplication): void {
  const config = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);

  // Atrás de proxy o `req.ip` seria o do proxy e o limite por IP viraria um contador único para o site
  // inteiro. Um NÚMERO de saltos (nunca `true`): o Express só olha os últimos N endereços do
  // `X-Forwarded-For`, então um cabeçalho forjado pelo cliente não escapa do limite.
  (app as NestExpressApplication).set(
    'trust proxy',
    config.get('TRUST_PROXY_HOPS', { infer: true }) ?? 0,
  );

  app.use(helmet());

  // Lê o cookie do refresh token (spec 01-fundacao-auth).
  app.use(cookieParser());

  // `credentials: true` + origem única (nunca `*`, recusado no boot): só o WEB_ORIGIN pode
  // chamar a API com cookie/sessão, quando ela existir (spec 01-fundacao-auth).
  app.enableCors({
    origin: config.get('WEB_ORIGIN', { infer: true }),
    credentials: true,
  });

  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter());
}
