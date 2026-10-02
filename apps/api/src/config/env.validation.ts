import { plainToInstance } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/** Tamanho minimo de cada segredo de assinatura dos tokens (spec 01-fundacao-auth). */
export const JWT_SECRET_MIN_LENGTH = 32;

/** Só a origem: `http(s)://host[:porta]`, sem barra final, caminho, query nem espaço. */
const ORIGIN_PATTERN = /^https?:\/\/[^\s/?#]+$/;
const ORIGIN_MESSAGE =
  'WEB_ORIGIN deve ser uma origem http(s) sem barra final nem caminho, ex.: http://localhost:5173';

export class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  /**
   * Origem única do frontend, usada no CORS. Nunca `*` com `credentials: true` — refletiria
   * qualquer origem e deixaria qualquer site reaproveitar a sessão (quando a sessão existir).
   */
  @Matches(ORIGIN_PATTERN, { message: ORIGIN_MESSAGE })
  WEB_ORIGIN: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsString()
  @IsNotEmpty()
  DIRECT_URL: string;

  /** Segredo do access token (HS256). Diferente do `JWT_REFRESH_SECRET` (spec 01-fundacao-auth). */
  @IsString()
  @MinLength(JWT_SECRET_MIN_LENGTH, {
    message: `JWT_ACCESS_SECRET deve ter pelo menos ${JWT_SECRET_MIN_LENGTH} caracteres`,
  })
  JWT_ACCESS_SECRET: string;

  /** Segredo do refresh token (HS256), separado para um token não valer no lugar do outro. */
  @IsString()
  @MinLength(JWT_SECRET_MIN_LENGTH, {
    message: `JWT_REFRESH_SECRET deve ter pelo menos ${JWT_SECRET_MIN_LENGTH} caracteres`,
  })
  JWT_REFRESH_SECRET: string;

  /** Usuário único criado pelo seed (spec 01-fundacao-auth). Registro fica desabilitado sempre. */
  @IsEmail({}, { message: 'SEED_USER_EMAIL deve ser um e-mail válido' })
  SEED_USER_EMAIL: string;

  @IsString()
  @MinLength(8, { message: 'SEED_USER_PASSWORD deve ter pelo menos 8 caracteres' })
  SEED_USER_PASSWORD: string;

  /** Credenciais do Meu Pluggy (spec 02-sync-pluggy). Nunca vão para log nem para o front. */
  @IsString()
  @IsNotEmpty()
  PLUGGY_CLIENT_ID: string;

  @IsString()
  @IsNotEmpty()
  PLUGGY_CLIENT_SECRET: string;

  /** Preenchido pelo spike de conexão; vazio até a primeira autorização. */
  @IsOptional()
  @IsString()
  PLUGGY_ITEM_ID?: string;

  /** Protege POST /sync (spec 02-sync-pluggy), chamado pelo cron externo (Render/GitHub Actions). */
  @IsString()
  @MinLength(JWT_SECRET_MIN_LENGTH, {
    message: `SYNC_CRON_TOKEN deve ter pelo menos ${JWT_SECRET_MIN_LENGTH} caracteres`,
  })
  SYNC_CRON_TOKEN: string;

  /** Chat com LLM (Fase 4). Ausente até lá — fica vazia de propósito. */
  @IsOptional()
  @IsString()
  OPENAI_API_KEY?: string;
}

/** Regras que envolvem mais de uma variável, fora do alcance de um decorator só. */
function extraProblems(config: EnvironmentVariables): string[] {
  const problems: string[] = [];

  if (
    typeof config.JWT_ACCESS_SECRET === 'string' &&
    config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET
  ) {
    problems.push(
      '  - JWT_REFRESH_SECRET: deve ser diferente de JWT_ACCESS_SECRET (segredos separados)',
    );
  }

  return problems;
}

/**
 * Executada pelo ConfigModule no boot: derruba a aplicação se alguma variável de ambiente
 * obrigatória estiver ausente ou inválida. A mensagem lista o problema de cada variável e NUNCA o
 * valor (segredos) — RULES.md §8.
 */
export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });

  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  const details = [
    ...errors.map(
      (error) => `  - ${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`,
    ),
    ...extraProblems(validatedConfig),
  ];

  if (details.length > 0) {
    throw new Error(`Variáveis de ambiente inválidas:\n${details.join('\n')}`);
  }

  return validatedConfig;
}
