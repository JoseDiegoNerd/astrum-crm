import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { loadEnv } from '../src/config.js';

// Sobe a aplicação sem banco: o cliente postgres só conecta na primeira consulta,
// e nenhuma das rotas testadas aqui chega a consultar.
describe('API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:1/unused',
      SUPABASE_URL: 'http://127.0.0.1:54321',
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1', { exclude: ['health'] });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /health é público', async () => {
    await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' });
  });

  it('GET /v1/me exige token', async () => {
    await request(app.getHttpServer()).get('/v1/me').expect(401);
  });

  it('GET /v1/me rejeita token inválido', async () => {
    await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', 'Bearer nao.e.um.jwt')
      .expect(401);
  });
});
