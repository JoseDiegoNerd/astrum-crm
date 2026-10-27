import 'reflect-metadata';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadEnv } from './config.js';
import { DatabaseErrorFilter } from './http/database-error.filter.js';
import { WORKSPACE_HEADER } from './tenancy/workspace.guard.js';

try {
  process.loadEnvFile();
} catch {
  // sem .env: variáveis vêm do ambiente (produção)
}

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule.forRoot(env));

  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.enableCors({
    origin: env.WEB_ORIGIN.split(','),
    allowedHeaders: ['authorization', 'content-type', WORKSPACE_HEADER],
  });
  app.useGlobalFilters(new DatabaseErrorFilter(app.get(HttpAdapterHost).httpAdapter));
  app.enableShutdownHooks();

  await app.listen(env.PORT);
}
await bootstrap();
