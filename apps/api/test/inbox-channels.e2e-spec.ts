import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createTestDatabase, insertInWorkspace, seedTenancy, type Tenancy, type TestDatabase } from '@astrum/db/testing';
import { AppModule } from '../src/app.module.js';
import { SupabaseJwtVerifier } from '../src/auth/supabase-jwt.verifier.js';
import { WhatsAppCloudAdapter } from '../src/channels/whatsapp/whatsapp.adapter.js';
import { loadEnv } from '../src/config.js';
import { DATABASE } from '../src/database/database.module.js';
import { DatabaseErrorFilter } from '../src/http/database-error.filter.js';

// Conexão de canais de ponta a ponta por HTTP, com a Graph API da Meta simulada.
const GOOD_TOKEN = 'EAAG-token-valido-de-teste-123456';

/** Meta simulada: aceita só GOOD_TOKEN; responde número, templates e envios. */
const fakeGraph = (async (url: string, init?: RequestInit) => {
  const token = (init?.headers as Record<string, string> | undefined)?.authorization;
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (token !== `Bearer ${GOOD_TOKEN}`) return json(401, { error: { message: 'Invalid OAuth access token', code: 190 } });
  if (url.includes('/message_templates')) {
    return json(200, {
      data: [
        { name: 'retomar_conversa', language: 'pt_BR', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Olá {{1}}, podemos continuar? {{1}} {{2}}' }] },
        { name: 'promo_rejeitada', language: 'pt_BR', status: 'REJECTED', components: [] },
        { name: 'boas_vindas', language: 'pt_BR', status: 'APPROVED', components: [{ type: 'BODY', text: 'Bem-vindo!' }] },
      ],
    });
  }
  if (url.includes('fields=display_phone_number')) return json(200, { display_phone_number: '+55 11 4000-0000', verified_name: 'Astrum Demo' });
  return json(200, { messages: [{ id: 'wamid.x' }] });
}) as unknown as typeof fetch;

describe('Canais: conectar WhatsApp (e2e)', () => {
  let testDb: TestDatabase;
  let t: Tenancy;
  let app: INestApplication;

  const call = (userId: string) => {
    const withHeaders = (r: request.Test) => r.set('authorization', `Bearer ${userId}`).set('x-workspace-id', t.a1);
    return {
      get: (path: string) => withHeaders(request(app.getHttpServer()).get(`/v1${path}`)),
      post: (path: string, body: object = {}) => withHeaders(request(app.getHttpServer()).post(`/v1${path}`)).send(body),
      patch: (path: string, body: object) => withHeaders(request(app.getHttpServer()).patch(`/v1${path}`)).send(body),
      delete: (path: string) => withHeaders(request(app.getHttpServer()).delete(`/v1${path}`)),
    };
  };
  const connect = (userId: string, overrides: Record<string, string> = {}) =>
    call(userId).post('/channels/whatsapp', {
      name: 'WhatsApp Vendas',
      phoneNumberId: '106540352242922',
      wabaId: '102290129340398',
      accessToken: GOOD_TOKEN,
      appSecret: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
      ...overrides,
    });
  const verify = (channelId: string, token: string) =>
    request(app.getHttpServer())
      .get(`/v1/webhooks/whatsapp/${channelId}`)
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': '42' });

  beforeAll(async () => {
    testDb = await createTestDatabase();
    t = await seedTenancy(testDb);
    const env = loadEnv({
      DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:1/unused',
      SUPABASE_URL: 'http://127.0.0.1:54321',
      CHANNEL_SECRETS_KEY: randomBytes(32).toString('base64'),
      PUBLIC_API_URL: 'https://api.astrum.test',
      INBOUND_POLL_MS: '0',
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
      .overrideProvider(DATABASE)
      .useValue(testDb.drizzle())
      .overrideProvider(SupabaseJwtVerifier)
      .useValue({ verify: async (token: string) => ({ sub: token, role: 'authenticated' }) })
      .overrideProvider(WhatsAppCloudAdapter)
      .useValue(new WhatsAppCloudAdapter({ graphVersion: 'v24.0', fetch: fakeGraph }))
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('v1', { exclude: ['health'] });
    app.useGlobalFilters(new DatabaseErrorFilter(app.get(HttpAdapterHost).httpAdapter));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await testDb?.close();
  });

  let channelId: string;
  let verifyToken: string;

  it('manager conecta: a Meta confirma o número, e o verify token aparece uma única vez', async () => {
    const response = await connect(t.mia.id).expect(201);
    channelId = response.body.channel.id;
    verifyToken = response.body.webhook.verifyToken;

    expect(response.body.channel).toMatchObject({
      status: 'connected',
      displayIdentifier: '+55 11 4000-0000',
      lastError: null,
      config: { verifiedName: 'Astrum Demo' },
    });
    expect(response.body.webhook.url).toBe(`https://api.astrum.test/v1/webhooks/whatsapp/${channelId}`);
    expect(verifyToken).toMatch(/^[\w-]{32}$/);
    // nada secreto volta, nem agora nem depois
    expect(JSON.stringify(response.body)).not.toMatch(/EAAG|a1b2c3d4|credentials/i);
    const list = await call(t.carol.id).get('/channels').expect(200);
    expect(JSON.stringify(list.body)).not.toMatch(/EAAG|a1b2c3d4|credentials|verifyToken/i);
    expect(list.body[0].webhookUrl).toBe(response.body.webhook.url);
  });

  it('o verify token gerado é o que a Meta precisa para validar o webhook', async () => {
    expect((await verify(channelId, verifyToken).expect(200)).text).toBe('42');
  });

  it('girar o token invalida o anterior', async () => {
    const rotated = await call(t.mia.id).post(`/channels/${channelId}/verify-token`).expect(200);
    await verify(channelId, verifyToken).expect(403);
    await verify(channelId, rotated.body.verifyToken).expect(200);
    verifyToken = rotated.body.verifyToken;
  });

  it('agent não conecta, não testa nem gira token', async () => {
    await connect(t.carol.id, { phoneNumberId: '999990000011111' }).expect(403);
    await call(t.carol.id).post(`/channels/${channelId}/test`).expect(403);
    await call(t.carol.id).post(`/channels/${channelId}/verify-token`).expect(403);
  });

  it('token recusado pela Meta: o canal fica com erro e o motivo; corrigir o token reconecta', async () => {
    const bad = await connect(t.mia.id, { phoneNumberId: '200000000000001', accessToken: 'EAAG-token-errado-000000000' }).expect(201);
    expect(bad.body.channel).toMatchObject({ status: 'error', lastError: 'Invalid OAuth access token' });

    const fixed = await call(t.mia.id).patch(`/channels/${bad.body.channel.id}`, { accessToken: GOOD_TOKEN }).expect(200);
    expect(fixed.body).toMatchObject({ status: 'connected', lastError: null });
  });

  it('o mesmo número não é conectado duas vezes', async () => {
    const duplicate = await connect(t.mia.id).expect(409);
    expect(duplicate.body.message).toMatch(/já está conectado/);
  });

  it('dados inválidos são recusados antes de falar com a Meta', async () => {
    const invalid = await connect(t.mia.id, { phoneNumberId: 'abc', accessToken: 'curto' }).expect(400);
    expect(JSON.stringify(invalid.body.issues)).toMatch(/phoneNumberId/);
  });

  it('lista só templates aprovados, com quantos parâmetros cada um pede', async () => {
    const { body } = await call(t.carol.id).get(`/channels/${channelId}/templates`).expect(200);
    expect(body).toEqual([
      { name: 'boas_vindas', language: 'pt_BR', parameterCount: 0, body: 'Bem-vindo!' },
      { name: 'retomar_conversa', language: 'pt_BR', category: 'UTILITY', parameterCount: 2, body: 'Olá {{1}}, podemos continuar? {{1}} {{2}}' },
    ]);
  });

  it('desativar faz o webhook parar; reativar testa e volta a conectar', async () => {
    const disabled = await call(t.mia.id).post(`/channels/${channelId}/disable`).expect(200);
    expect(disabled.body.status).toBe('disabled');
    await verify(channelId, verifyToken).expect(404);

    const enabled = await call(t.mia.id).post(`/channels/${channelId}/enable`).expect(200);
    expect(enabled.body.status).toBe('connected');
    await verify(channelId, verifyToken).expect(200);
  });

  it('canal com conversas não é excluído; sem conversas, é', async () => {
    const contact = await insertInWorkspace(testDb, t.a1, 'contacts', { name: 'Ana' });
    await insertInWorkspace(testDb, t.a1, 'conversations', { channel_id: channelId, contact_id: contact });
    const blocked = await call(t.mia.id).delete(`/channels/${channelId}`).expect(409);
    expect(blocked.body.message).toMatch(/desative-o em vez de excluir/);

    const spare = await connect(t.mia.id, { phoneNumberId: '300000000000003' }).expect(201);
    await call(t.mia.id).delete(`/channels/${spare.body.channel.id}`).expect(204);
  });
});
