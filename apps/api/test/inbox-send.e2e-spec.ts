import 'reflect-metadata';
import { createHmac, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createTestDatabase, insertInWorkspace, one, seedTenancy, type Tenancy, type TestDatabase } from '@astrum/db/testing';
import { AppModule } from '../src/app.module.js';
import { SupabaseJwtVerifier } from '../src/auth/supabase-jwt.verifier.js';
import { SecretBox } from '../src/channels/secrets.js';
import { WhatsAppCloudAdapter } from '../src/channels/whatsapp/whatsapp.adapter.js';
import { loadEnv } from '../src/config.js';
import { DATABASE } from '../src/database/database.module.js';
import { DatabaseErrorFilter } from '../src/http/database-error.filter.js';
import { InboxWorker } from '../src/inbox/inbox.worker.js';
import { hashVerifyToken } from '../src/inbox/webhooks.controller.js';
import { metaId } from './meta-ids.js';

// Atendimento de ponta a ponta por HTTP: inbox → resposta → fila de saída → Meta (simulada) → status.
const PHONE_NUMBER_ID = metaId();
const APP_SECRET = 'app-secret-de-teste';

/** Meta simulada: cada envio consome a próxima resposta programada (padrão: sucesso). */
class FakeMeta {
  calls: { url: string; body: Record<string, unknown>; token: string }[] = [];
  private responses: { status: number; json: unknown }[] = [];
  private seq = 0;

  respondNext(status: number, json: unknown) {
    this.responses.push({ status, json });
  }

  fetch = (async (url: string, init: RequestInit) => {
    this.calls.push({
      url,
      body: JSON.parse(String(init.body)),
      token: (init.headers as Record<string, string>).authorization,
    });
    const next = this.responses.shift() ?? { status: 200, json: { messages: [{ id: `wamid.out${++this.seq}` }] } };
    return new Response(JSON.stringify(next.json), { status: next.status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

describe('Inbox: atendimento e envio (e2e)', () => {
  let testDb: TestDatabase;
  let t: Tenancy;
  let app: INestApplication;
  let worker: InboxWorker;
  let meta: FakeMeta;
  let channelId: string;
  let conversationId: string;

  // token falso = id do usuário (o verificador real é trocado no teste)
  const as = (userId: string) => ({
    get: (path: string) => request(app.getHttpServer()).get(`/v1${path}`).set('authorization', `Bearer ${userId}`).set('x-workspace-id', t.a1),
    post: (path: string, body?: object) =>
      request(app.getHttpServer()).post(`/v1${path}`).set('authorization', `Bearer ${userId}`).set('x-workspace-id', t.a1).send(body ?? {}),
    patch: (path: string, body: object) =>
      request(app.getHttpServer()).patch(`/v1${path}`).set('authorization', `Bearer ${userId}`).set('x-workspace-id', t.a1).send(body),
  });
  const webhook = async (value: Record<string, unknown>) => {
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, ...value } }] }],
    });
    await request(app.getHttpServer())
      .post(`/v1/webhooks/whatsapp/${channelId}`)
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`)
      .send(raw)
      .expect(200);
    await worker.idle();
  };
  const incoming = (id: string, body: string, from = '5511999990000', name = 'Ana Souza') =>
    webhook({
      contacts: [{ wa_id: from, profile: { name } }],
      messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } }],
    });
  const sendText = async (userId: string, body: string, conversation = conversationId) => {
    const response = await as(userId).post(`/conversations/${conversation}/messages`, { type: 'text', body });
    await worker.idle();
    return response;
  };
  const messageByBody = (body: string) =>
    one<{ status: string; external_id: string | null; send_attempts: number; error: { message?: string } | null }>(
      testDb,
      `select status, external_id, send_attempts, error from messages where body = $1`,
      [body],
    );

  beforeAll(async () => {
    testDb = await createTestDatabase();
    t = await seedTenancy(testDb);
    const key = randomBytes(32).toString('base64');
    channelId = await insertInWorkspace(testDb, t.a1, 'channels', {
      type: 'whatsapp',
      name: 'WhatsApp Vendas',
      external_id: PHONE_NUMBER_ID,
      status: 'connected',
    });
    await testDb.query(`update channels set credentials_enc = $1, webhook_secret_hash = $2 where id = $3`, [
      new SecretBox(key).seal({ appSecret: APP_SECRET, accessToken: 'EAAG-token-do-canal' }),
      hashVerifyToken('verify'),
      channelId,
    ]);

    meta = new FakeMeta();
    const env = loadEnv({
      DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:1/unused',
      SUPABASE_URL: 'http://127.0.0.1:54321',
      CHANNEL_SECRETS_KEY: key,
      INBOUND_POLL_MS: '0',
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
      .overrideProvider(DATABASE)
      .useValue(testDb.drizzle())
      .overrideProvider(SupabaseJwtVerifier)
      .useValue({ verify: async (token: string) => ({ sub: token, role: 'authenticated' }) })
      .overrideProvider(WhatsAppCloudAdapter)
      .useValue(new WhatsAppCloudAdapter({ graphVersion: 'v24.0', fetch: meta.fetch }))
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('v1', { exclude: ['health'] });
    app.useGlobalFilters(new DatabaseErrorFilter(app.get(HttpAdapterHost).httpAdapter));
    await app.init();
    worker = app.get(InboxWorker);

    await incoming('wamid.in1', 'Vocês entregam no centro?');
  });

  afterAll(async () => {
    await app?.close();
    await testDb?.close();
  });

  it('a conversa aparece no inbox com prévia, não lidas e janela aberta', async () => {
    const { body } = await as(t.carol.id).get('/conversations').expect(200);
    expect(body.items).toHaveLength(1);
    const [conversation] = body.items;
    conversationId = conversation.id;
    expect(conversation).toMatchObject({
      contactName: 'Ana Souza',
      channelName: 'WhatsApp Vendas',
      status: 'open',
      unreadCount: 1,
      assigneeId: null,
      lastMessage: { body: 'Vocês entregam no centro?', direction: 'in' },
      capabilities: { freeText: true },
    });
  });

  it('canais são listados sem segredos', async () => {
    const { body } = await as(t.vic.id).get('/channels').expect(200);
    expect(body).toHaveLength(1);
    expect(Object.keys(body[0])).not.toContain('credentialsEnc');
    expect(JSON.stringify(body)).not.toContain('EAAG');
  });

  it('agent responde: fica na fila, o worker envia pela Meta e grava o id', async () => {
    const response = await sendText(t.carol.id, 'Entregamos sim!');
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ status: 'queued', direction: 'out', senderId: t.carol.id });

    const call = meta.calls.at(-1)!;
    expect(call.url).toBe(`https://graph.facebook.com/v24.0/${PHONE_NUMBER_ID}/messages`);
    expect(call.token).toBe('Bearer EAAG-token-do-canal');
    expect(call.body).toMatchObject({ to: '5511999990000', type: 'text', text: { body: 'Entregamos sim!' } });

    expect(await messageByBody('Entregamos sim!')).toMatchObject({ status: 'sent', external_id: 'wamid.out1', send_attempts: 1 });
    const conversation = await one<{ unread_count: number; last_outbound_at: Date | null }>(
      testDb,
      `select unread_count, last_outbound_at from conversations where id = $1`,
      [conversationId],
    );
    expect(conversation.unread_count).toBe(0);
    expect(conversation.last_outbound_at).toBeInstanceOf(Date);
  });

  it('status da Meta chegam até "lido" e as mensagens saem em ordem, com o autor', async () => {
    await webhook({ statuses: [{ id: 'wamid.out1', status: 'delivered', timestamp: '1', recipient_id: '5511999990000' }] });
    await webhook({ statuses: [{ id: 'wamid.out1', status: 'read', timestamp: '2', recipient_id: '5511999990000' }] });
    const { body } = await as(t.carol.id).get(`/conversations/${conversationId}/messages`).expect(200);
    expect(body.items.map((m: { direction: string; status: string }) => [m.direction, m.status])).toEqual([
      ['in', 'received'],
      ['out', 'read'],
    ]);
    expect(body.items[1].senderName).toContain('carol');
  });

  it('fora da janela de 24 h: texto é recusado e template é enviado', async () => {
    await testDb.query(`update conversations set last_inbound_at = now() - interval '2 days' where id = $1`, [conversationId]);
    const refused = await sendText(t.carol.id, 'Ainda está aí?');
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'TEMPLATE_REQUIRED', message: expect.stringContaining('24 h') });

    const template = await as(t.carol.id).post(`/conversations/${conversationId}/messages`, {
      type: 'template',
      template: { name: 'retomar_conversa', language: 'pt_BR', parameters: ['Ana'] },
    });
    await worker.idle();
    expect(template.status).toBe(202);
    expect(meta.calls.at(-1)!.body).toMatchObject({ type: 'template', template: { name: 'retomar_conversa', language: { code: 'pt_BR' } } });
    expect(await messageByBody('Template: retomar_conversa')).toMatchObject({ status: 'sent' });
    await testDb.query(`update conversations set last_inbound_at = now() where id = $1`, [conversationId]);
  });

  it('limite de taxa da Meta: tenta de novo depois; token inválido: falha com o motivo', async () => {
    meta.respondNext(429, { error: { message: 'Too many messages', code: 130429 } });
    await sendText(t.carol.id, 'Segue o orçamento');
    expect(await messageByBody('Segue o orçamento')).toMatchObject({ status: 'queued', send_attempts: 1, error: { message: 'Too many messages' } });

    await testDb.query(`update messages set next_attempt_at = now() where body = 'Segue o orçamento'`);
    worker.kick();
    await worker.idle();
    expect(await messageByBody('Segue o orçamento')).toMatchObject({ status: 'sent', send_attempts: 2, error: null });

    meta.respondNext(401, { error: { message: 'Invalid OAuth access token', code: 190 } });
    await sendText(t.carol.id, 'Mensagem com token vencido');
    expect(await messageByBody('Mensagem com token vencido')).toMatchObject({
      status: 'failed',
      error: { message: 'Invalid OAuth access token' },
    });
  });

  it('viewer não responde; quem não é do workspace não acessa', async () => {
    expect((await sendText(t.vic.id, 'oi')).status).toBe(403);
    await as(t.bob.id).get(`/conversations/${conversationId}`).expect(403);
  });

  it('atribuição: agent pega para si; só manager passa para outra pessoa', async () => {
    const toOther = await as(t.carol.id).patch(`/conversations/${conversationId}`, { assigneeId: t.mia.id });
    expect(toOther.status).toBe(403);
    expect(toOther.body.message).toBe('Só managers atribuem conversas a outras pessoas');

    await as(t.carol.id).patch(`/conversations/${conversationId}`, { assigneeId: t.carol.id }).expect(200);
    const mine = await as(t.carol.id).get('/conversations?assignee=me').expect(200);
    expect(mine.body.items.map((c: { id: string }) => c.id)).toEqual([conversationId]);
    expect((await as(t.carol.id).get('/conversations?assignee=none')).body.items).toEqual([]);

    const byManager = await as(t.mia.id).patch(`/conversations/${conversationId}`, { assigneeId: t.mia.id }).expect(200);
    expect(byManager.body.assigneeName).toContain('mia');
  });

  it('não lidas e busca pelo nome do contato', async () => {
    await incoming('wamid.in2', 'Obrigada!');
    expect((await as(t.carol.id).get('/conversations?unread=true')).body.items).toHaveLength(1);
    await as(t.carol.id).post(`/conversations/${conversationId}/read`).expect(200);
    expect((await as(t.carol.id).get('/conversations?unread=true')).body.items).toHaveLength(0);
    expect((await as(t.carol.id).get('/conversations?q=Ana')).body.items).toHaveLength(1);
    expect((await as(t.carol.id).get('/conversations?q=Zé')).body.items).toHaveLength(0);
  });

  it('resolvida: não aceita resposta; nova mensagem abre outra conversa; reabrir a antiga conflita', async () => {
    await as(t.carol.id).patch(`/conversations/${conversationId}`, { status: 'resolved' }).expect(200);
    const refused = await sendText(t.carol.id, 'Depois de resolver');
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/reabra a conversa/);

    await incoming('wamid.in3', 'Oi de novo');
    const active = await as(t.carol.id).get('/conversations').expect(200);
    expect(active.body.items).toHaveLength(1);
    expect(active.body.items[0].id).not.toBe(conversationId);

    const reopen = await as(t.carol.id).patch(`/conversations/${conversationId}`, { status: 'open' });
    expect(reopen.status).toBe(409);
    expect(reopen.body.message).toBe('Já existe uma conversa ativa com este contato neste canal');
    expect((await as(t.carol.id).get('/conversations?status=resolved')).body.items).toHaveLength(1);
  });
});
