import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupApp } from './app.setup';
import { type EnvironmentVariables } from './config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);

  setupApp(app);

  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  Logger.log(`API em http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
