import 'reflect-metadata';
import { createHmac, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createTestDatabase, insertInWorkspace, one, seedTenancy, type Tenancy, type TestDatabase } from '@astrum/db/testing';
import { AppModule } from '../src/app.module.js';
import { SecretBox } from '../src/channels/secrets.js';
import { loadEnv } from '../src/config.js';
import { DATABASE } from '../src/database/database.module.js';
import { DatabaseErrorFilter } from '../src/http/database-error.filter.js';
import { InboundProcessor } from '../src/inbox/inbound.processor.js';
import { InboundWorker } from '../src/inbox/inbound.worker.js';
import { hashVerifyToken } from '../src/inbox/webhooks.controller.js';

// Webhook do WhatsApp de ponta a ponta: HTTP → assinatura → fila → contato/conversa/mensagem.
const PHONE_NUMBER_ID = '106540352242922';
const APP_SECRET = 'app-secret-de-teste';
const VERIFY_TOKEN = 'verify-token-de-teste';

const payload = (value: Record<string, unknown>, phoneNumberId = PHONE_NUMBER_ID) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phoneNumberId }, ...value } }] }],
});
const textFrom = (waId: string, id: string, body: string, name = 'Cliente', extra: Record<string, unknown> = {}) =>
  payload({
    contacts: [{ wa_id: waId, profile: { name } }],
    messages: [{ from: waId, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body }, ...extra }],
  });
const statusOf = (id: string, status: string) =>
  payload({ statuses: [{ id, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: '5511999990000' }] });

describe('Webhook do WhatsApp (e2e)', () => {
  let testDb: TestDatabase;
  let t: Tenancy;
  let app: INestApplication;
  let worker: InboundWorker;
  let processor: InboundProcessor;
  let channelId: string;
  let disabledChannelId: string;

  const post = (body: unknown, secret = APP_SECRET, id = channelId) => {
    const raw = JSON.stringify(body);
    const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    return request(app.getHttpServer())
      .post(`/v1/webhooks/whatsapp/${id}`)
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', signature)
      .send(raw);
  };
  const deliver = async (body: unknown) => {
    const response = await post(body).expect(200);
    await worker.idle();
    return response.body as { received: number; queued: number };
  };
  const contactByPhone = (identifier: string) =>
    testDb.query<{ contact_id: string; name: string; verified: boolean; channel: string }>(
      `select i.contact_id, c.name, i.verified, i.channel from contact_identities i join contacts c on c.id = i.contact_id
       where i.workspace_id = $1 and i.identifier = $2 order by i.channel`,
      [t.a1, identifier],
    );

  beforeAll(async () => {
    testDb = await createTestDatabase();
    t = await seedTenancy(testDb);
    const key = randomBytes(32).toString('base64');
    const box = new SecretBox(key);

    const insertChannel = async (status: string, externalId: string) => {
      const id = await insertInWorkspace(testDb, t.a1, 'channels', {
        type: 'whatsapp',
        name: 'WhatsApp Vendas',
        external_id: externalId,
        status,
      });
      await testDb.query(`update channels set credentials_enc = $1, webhook_secret_hash = $2 where id = $3`, [
        box.seal({ appSecret: APP_SECRET, accessToken: 'EAAG-teste' }),
        hashVerifyToken(VERIFY_TOKEN),
        id,
      ]);
      return id;
    };
    channelId = await insertChannel('connected', PHONE_NUMBER_ID);
    disabledChannelId = await insertChannel('disabled', 'outro-numero');

    const env = loadEnv({
      DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:1/unused',
      SUPABASE_URL: 'http://127.0.0.1:54321',
      CHANNEL_SECRETS_KEY: key,
      INBOUND_POLL_MS: '0',
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
      .overrideProvider(DATABASE)
      .useValue(testDb.drizzle())
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('v1', { exclude: ['health'] });
    app.useGlobalFilters(new DatabaseErrorFilter(app.get(HttpAdapterHost).httpAdapter));
    await app.init();
    worker = app.get(InboundWorker);
    processor = app.get(InboundProcessor);
  });

  afterAll(async () => {
    await app?.close();
    await testDb?.close();
  });

  describe('verificação (GET)', () => {
    const verify = (query: Record<string, string>, id = channelId) =>
      request(app.getHttpServer()).get(`/v1/webhooks/whatsapp/${id}`).query(query);

    it('devolve o hub.challenge com o verify token certo', async () => {
      const response = await verify({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1158201444' }).expect(200);
      expect(response.text).toBe('1158201444');
      expect(response.headers['content-type']).toMatch(/text\/plain/);
    });

    it('recusa token errado, canal desconhecido ou desativado', async () => {
      await verify({ 'hub.mode': 'subscribe', 'hub.verify_token': 'errado', 'hub.challenge': '1' }).expect(403);
      await verify({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1' }, crypto.randomUUID()).expect(404);
      await verify({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1' }, disabledChannelId).expect(404);
      await verify({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1' }, 'nao-e-uuid').expect(404);
    });
  });

  describe('recebimento (POST)', () => {
    it('recusa assinatura inválida sem gravar nada', async () => {
      await post(textFrom('5511911112222', 'wamid.hack', 'oi'), 'segredo-errado').expect(401);
      expect(await testDb.query(`select 1 from inbound_events where external_id = 'msg:wamid.hack'`)).toHaveLength(0);
    });

    it('número novo vira lead com WhatsApp verificado, conversa aberta e mensagem', async () => {
      const result = await deliver(textFrom('5511999990000', 'wamid.1', 'Oi, vocês entregam?', 'Ana Souza'));
      expect(result).toEqual({ received: 1, queued: 1 });

      const [identity] = await contactByPhone('+5511999990000');
      expect(identity).toMatchObject({ name: 'Ana Souza', verified: true, channel: 'whatsapp' });

      const conversation = await one<{ id: string; status: string; unread_count: number; last_inbound_at: Date | null }>(
        testDb,
        `select id, status, unread_count, last_inbound_at from conversations where contact_id = $1`,
        [identity!.contact_id],
      );
      expect(conversation).toMatchObject({ status: 'open', unread_count: 1 });
      expect(conversation.last_inbound_at).toBeInstanceOf(Date);

      const message = await one<{ direction: string; sender_type: string; body: string; status: string }>(
        testDb,
        `select direction, sender_type, body, status from messages where external_id = 'wamid.1'`,
      );
      expect(message).toEqual({ direction: 'in', sender_type: 'contact', body: 'Oi, vocês entregam?', status: 'received' });

      const activity = await one<{ type: string; actor_id: string | null }>(
        testDb,
        `select type, actor_id from activities where conversation_id = $1`,
        [conversation.id],
      );
      expect(activity).toEqual({ type: 'conversation.opened', actor_id: null });
    });

    it('a Meta reenviando o mesmo evento não duplica nada', async () => {
      const again = await deliver(textFrom('5511999990000', 'wamid.1', 'Oi, vocês entregam?', 'Ana Souza'));
      expect(again).toEqual({ received: 1, queued: 0 });
      expect(await testDb.query(`select 1 from messages where external_id = 'wamid.1'`)).toHaveLength(1);
    });

    it('próxima mensagem cai na mesma conversa e liga a resposta citada', async () => {
      await deliver(textFrom('5511999990000', 'wamid.2', 'Para o centro?', 'Ana Souza', { context: { id: 'wamid.1' } }));
      const rows = await testDb.query<{ conversation_id: string; unread_count: number }>(
        `select m.conversation_id, c.unread_count from messages m join conversations c on c.id = m.conversation_id
         where m.external_id in ('wamid.1', 'wamid.2')`,
      );
      expect(new Set(rows.map((r) => r.conversation_id)).size).toBe(1);
      expect(rows[0]!.unread_count).toBe(2);
      const reply = await one<{ reply_to_id: string | null }>(
        testDb,
        `select reply_to_id from messages where external_id = 'wamid.2'`,
      );
      expect(reply.reply_to_id).not.toBeNull();
    });

    it('acha contato cadastrado por telefone sem o 9º dígito em vez de duplicar', async () => {
      const existing = await insertInWorkspace(testDb, t.a1, 'contacts', { name: 'Bruno da planilha' });
      await insertInWorkspace(testDb, t.a1, 'contact_identities', {
        contact_id: existing,
        channel: 'phone',
        identifier: '+552188887777',
        is_primary: true,
      });
      await deliver(textFrom('5521988887777', 'wamid.bruno', 'Bom dia', 'Bruno'));

      const identities = await testDb.query<{ contact_id: string; channel: string }>(
        `select contact_id, channel from contact_identities where contact_id = $1 order by channel`,
        [existing],
      );
      expect(identities.map((i) => i.channel)).toEqual(['phone', 'whatsapp']);
      expect(await testDb.query(`select 1 from contacts where name = 'Bruno'`)).toHaveLength(0);
    });

    it('conversa resolvida: a próxima mensagem abre uma nova', async () => {
      const [identity] = await contactByPhone('+5511999990000');
      await testDb.query(`update conversations set status = 'resolved' where contact_id = $1`, [identity!.contact_id]);
      await deliver(textFrom('5511999990000', 'wamid.3', 'Voltei!', 'Ana Souza'));
      const conversations = await testDb.query<{ status: string }>(
        `select status from conversations where contact_id = $1 order by created_at`,
        [identity!.contact_id],
      );
      expect(conversations.map((c) => c.status)).toEqual(['resolved', 'open']);
    });

    it('ignora eventos de outro número que venham no mesmo webhook', async () => {
      const result = await deliver(textFrom('5511977776666', 'wamid.outro', 'x', 'X', {}));
      expect(result.queued).toBe(1);
      const foreign = payload(
        { contacts: [{ wa_id: '5511966665555' }], messages: [{ from: '5511966665555', id: 'wamid.f', timestamp: '1', type: 'text', text: { body: 'x' } }] },
        'numero-de-outro-cliente',
      );
      expect(await deliver(foreign)).toEqual({ received: 0, queued: 0 });
    });

    it('o contato criado fica só no workspace do canal', async () => {
      await insertInWorkspace(testDb, t.a2, 'contacts', { name: 'Filial' });
      const inA2 = await testDb.query(
        `select 1 from contact_identities where workspace_id = $1 and identifier = '+5511999990000'`,
        [t.a2],
      );
      expect(inA2).toHaveLength(0);
    });
  });

  describe('status de entrega', () => {
    let conversationId: string;

    beforeAll(async () => {
      const [identity] = await contactByPhone('+5511999990000');
      conversationId = (
        await one<{ id: string }>(testDb, `select id from conversations where contact_id = $1 and status = 'open'`, [identity!.contact_id])
      ).id;
    });

    it('status antes da mensagem existir fica na fila e é aplicado depois', async () => {
      await deliver(statusOf('wamid.saida', 'delivered'));
      const event = await one<{ status: string; attempts: number }>(
        testDb,
        `select status, attempts from inbound_events where external_id = 'status:wamid.saida:delivered'`,
      );
      expect(event).toEqual({ status: 'pending', attempts: 1 });

      // o envio é gravado; a nova tentativa encontra a mensagem
      await testDb.query(
        `insert into messages (tenant_id, workspace_id, conversation_id, channel_id, direction, sender_type, body, external_id, status)
         values ($1, $2, $3, $4, 'out', 'user', 'Entregamos sim!', 'wamid.saida', 'sent')`,
        [t.tenantA, t.a1, conversationId, channelId],
      );
      await testDb.query(`update inbound_events set next_attempt_at = now() where external_id = 'status:wamid.saida:delivered'`);
      await processor.processPending();

      const message = await one<{ status: string; delivered_at: Date | null }>(
        testDb,
        `select status, delivered_at from messages where external_id = 'wamid.saida'`,
      );
      expect(message.status).toBe('delivered');
      expect(message.delivered_at).toBeInstanceOf(Date);
    });

    it('status só avança: "lido" não volta para "entregue" e falha tardia é ignorada', async () => {
      await deliver(statusOf('wamid.saida', 'read'));
      await deliver(statusOf('wamid.saida', 'sent'));
      await deliver(payload({ statuses: [{ id: 'wamid.saida', status: 'failed', timestamp: '1', errors: [{ code: 131026 }] }] }));
      const message = await one<{ status: string; read_at: Date | null; error: unknown }>(
        testDb,
        `select status, read_at, error from messages where external_id = 'wamid.saida'`,
      );
      expect(message.status).toBe('read');
      expect(message.read_at).toBeInstanceOf(Date);
      expect(message.error).toBeNull();
    });

    it('falha guarda o motivo da Meta', async () => {
      await testDb.query(
        `insert into messages (tenant_id, workspace_id, conversation_id, channel_id, direction, sender_type, body, external_id, status)
         values ($1, $2, $3, $4, 'out', 'user', 'Promoção', 'wamid.falha', 'sent')`,
        [t.tenantA, t.a1, conversationId, channelId],
      );
      await deliver(
        payload({
          statuses: [{ id: 'wamid.falha', status: 'failed', timestamp: '1', errors: [{ code: 131047, title: 'Re-engagement message' }] }],
        }),
      );
      const message = await one<{ status: string; error: { code: number; title: string } }>(
        testDb,
        `select status, error from messages where external_id = 'wamid.falha'`,
      );
      expect(message).toMatchObject({ status: 'failed', error: { code: 131047, title: 'Re-engagement message' } });
    });
  });
});
