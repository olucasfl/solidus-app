import { type ConfigService } from '@nestjs/config';
import { type EnvironmentVariables } from './env.validation';

/** ConfigService tipado com as variáveis validadas em env.validation.ts. */
export type AppConfigService = ConfigService<EnvironmentVariables, true>;
