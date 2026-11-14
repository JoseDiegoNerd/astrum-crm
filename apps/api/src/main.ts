import 'reflect-metadata';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
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
  // rawBody: webhooks validam a assinatura sobre o corpo exato recebido
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), { rawBody: true });
  // importação de CSV envia o arquivo inteiro (até ~5 MB) no corpo JSON
  app.useBodyParser('json', { limit: '6mb' });

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
