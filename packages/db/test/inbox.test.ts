import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertInWorkspace, one, seedTenancy, type Tenancy } from '../src/testing/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../src/testing/harness.js';
import { describeWorkspaceTable } from './workspace-table-suite.js';

let seq = 0;
const channelIn = (db: TestDatabase, workspaceId: string) =>
  insertInWorkspace(db, workspaceId, 'channels', {
    type: 'whatsapp',
    name: `WhatsApp ${++seq}`,
    external_id: `phone-${crypto.randomUUID()}`,
  });

describeWorkspaceTable({
  table: 'channels',
  writers: 'manager',
  values: async () => ({ type: 'whatsapp', name: 'Vendas', external_id: `phone-${crypto.randomUUID()}` }),
  update: { name: 'Vendas SP' },
});

describeWorkspaceTable({
  table: 'conversations',
  values: async (ws, db) => ({
    channel_id: await channelIn(db, ws.workspaceId),
    contact_id: await insertInWorkspace(db, ws.workspaceId, 'contacts', { name: `Contato ${++seq}` }),
  }),
  update: { subject: 'Orçamento' },
});

describe('regras do inbox', () => {
  let db: TestDatabase;
  let t: Tenancy;
  let channelA1: string;
  let contactA1: string;

  const asUser = <T>(userId: string, sql: string, params?: unknown[]) =>
    db.asUser(userId, (q) => q.query<T>(sql, params));
  const openConversation = async (userId = t.carol.id, contactId = contactA1, channelId = channelA1) =>
    (
      await asUser<{ id: string }>(
        userId,
        `insert into conversations (tenant_id, workspace_id, channel_id, contact_id) values ($1, $2, $3, $4) returning id`,
        [t.tenantA, t.a1, channelId, contactId],
      )
    )[0]!.id;
  const sendText = (userId: string, conversationId: string, body = 'Olá!', channelId = channelA1) =>
    asUser<{ id: string }>(
      userId,
      `insert into messages (tenant_id, workspace_id, conversation_id, channel_id, direction, sender_type, body)
       values ($1, $2, $3, $4, 'out', 'user', $5) returning id`,
      [t.tenantA, t.a1, conversationId, channelId, body],
    );

  beforeAll(async () => {
    db = await createTestDatabase();
    t = await seedTenancy(db);
    channelA1 = await channelIn(db, t.a1);
    contactA1 = await insertInWorkspace(db, t.a1, 'contacts', { name: 'Ana' });
  });

  afterAll(async () => {
    await db?.close();
  });

  describe('segredos dos canais', () => {
    it('ninguém lê token nem segredo do webhook — nem o owner', async () => {
      for (const column of ['credentials_enc', 'webhook_secret_hash']) {
        await expect(asUser(t.alice.id, `select ${column} from channels`)).rejects.toThrow(/permission denied/);
      }
      await expect(asUser(t.alice.id, `select * from channels`)).rejects.toThrow(/permission denied/);
      // colunas públicas continuam legíveis
      expect(await asUser(t.vic.id, `select id, name, status from channels where id = $1`, [channelA1])).toHaveLength(1);
    });

    it('manager grava os segredos; agent não', async () => {
      expect(
        await asUser(t.mia.id, `update channels set credentials_enc = '\\x0102'::bytea where id = $1 returning id`, [channelA1]),
      ).toHaveLength(1);
      expect(
        await asUser(t.carol.id, `update channels set credentials_enc = '\\x03'::bytea where id = $1 returning id`, [channelA1]),
      ).toHaveLength(0);
      const stored = await one<{ credentials_enc: Buffer | Uint8Array }>(
        db,
        `select credentials_enc from channels where id = $1`,
        [channelA1],
      );
      expect(Array.from(stored.credentials_enc)).toEqual([1, 2]);
    });

    it('o mesmo número não é conectado duas vezes (nem por outro tenant)', async () => {
      const { external_id } = await one<{ external_id: string }>(db, `select external_id from channels where id = $1`, [channelA1]);
      await expect(
        asUser(t.bob.id, `insert into channels (tenant_id, workspace_id, type, name, external_id) values ($1, $2, 'whatsapp', 'X', $3)`,
          [t.tenantB, t.b1, external_id]),
      ).rejects.toThrow(/unique/);
    });

    it('eventos brutos de webhook são só do serviço', async () => {
      await db.query(
        `insert into inbound_events (tenant_id, workspace_id, channel_id, external_id, payload) values ($1, $2, $3, 'wamid.1', '{}')`,
        [t.tenantA, t.a1, channelA1],
      );
      await expect(asUser(t.alice.id, `select 1 from inbound_events`)).rejects.toThrow(/permission denied/);
      await expect(
        asUser(t.alice.id, `insert into inbound_events (tenant_id, workspace_id, channel_id, external_id, payload) values ($1, $2, $3, 'x', '{}')`,
          [t.tenantA, t.a1, channelA1]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query(`insert into inbound_events (tenant_id, workspace_id, channel_id, external_id, payload) values ($1, $2, $3, 'wamid.1', '{}')`,
          [t.tenantA, t.a1, channelA1]),
      ).rejects.toThrow(/unique/);
    });
  });

  describe('conversas', () => {
    it('uma conversa ativa por canal e contato; resolver libera uma nova', async () => {
      const first = await openConversation();
      await expect(openConversation()).rejects.toThrow(/conversations_one_active_key/);

      await asUser(t.carol.id, `update conversations set status = 'resolved' where id = $1`, [first]);
      const resolved = await one<{ resolved_at: Date | null }>(db, `select resolved_at from conversations where id = $1`, [first]);
      expect(resolved.resolved_at).toBeInstanceOf(Date);

      const second = await openConversation();
      expect(second).not.toBe(first);
      await asUser(t.carol.id, `update conversations set status = 'open' where id = $1`, [second]);
    });

    it('agent pega para si e solta; não passa para outra pessoa; manager passa', async () => {
      const contact = await insertInWorkspace(db, t.a1, 'contacts', { name: 'Bruno' });
      const id = await openConversation(t.carol.id, contact);
      expect(await asUser(t.carol.id, `update conversations set assignee_id = $1 where id = $2 returning id`, [t.carol.id, id]))
        .toHaveLength(1);
      await expect(asUser(t.carol.id, `update conversations set assignee_id = $1 where id = $2`, [t.mia.id, id]))
        .rejects.toThrow(/Só managers atribuem/);
      expect(await asUser(t.mia.id, `update conversations set assignee_id = $1 where id = $2 returning id`, [t.mia.id, id]))
        .toHaveLength(1);
      expect(await asUser(t.mia.id, `update conversations set assignee_id = $1 where id = $2 returning id`, [t.carol.id, id]))
        .toHaveLength(1);
      // agent resolve uma conversa que está com outra pessoa
      await asUser(t.mia.id, `update conversations set assignee_id = $1 where id = $2`, [t.mia.id, id]);
      expect(await asUser(t.carol.id, `update conversations set status = 'resolved' where id = $1 returning id`, [id]))
        .toHaveLength(1);
    });

    it('agent não cria conversa já atribuída a outra pessoa', async () => {
      const contact = await insertInWorkspace(db, t.a1, 'contacts', { name: 'Carla' });
      await expect(asUser(t.carol.id,
        `insert into conversations (tenant_id, workspace_id, channel_id, contact_id, assignee_id) values ($1, $2, $3, $4, $5)`,
        [t.tenantA, t.a1, channelA1, contact, t.mia.id])).rejects.toThrow(/row-level security/);
    });

    it('contadores e última mensagem são do sistema; usuário só zera não lidas', async () => {
      const contact = await insertInWorkspace(db, t.a1, 'contacts', { name: 'Davi' });
      const id = await openConversation(t.carol.id, contact);
      await expect(asUser(t.carol.id, `update conversations set last_inbound_at = now() where id = $1`, [id]))
        .rejects.toThrow(/permission denied/);
      expect(await asUser(t.carol.id, `update conversations set unread_count = 0 where id = $1 returning id`, [id])).toHaveLength(1);
    });

    it('canal com conversas não é apagado', async () => {
      await expect(asUser(t.mia.id, `delete from channels where id = $1`, [channelA1])).rejects.toThrow(/foreign key/);
    });
  });

  describe('mensagens', () => {
    let conversationId: string;

    beforeAll(async () => {
      const contact = await insertInWorkspace(db, t.a1, 'contacts', { name: 'Eva' });
      conversationId = await openConversation(t.carol.id, contact);
    });

    it('agent envia (fica "queued", em nome próprio)', async () => {
      const [msg] = await sendText(t.carol.id, conversationId);
      const row = await one<{ status: string; sender_id: string }>(db, `select status, sender_id from messages where id = $1`, [msg!.id]);
      expect(row).toEqual({ status: 'queued', sender_id: t.carol.id });
    });

    it('usuário não forja mensagem recebida, remetente nem status', async () => {
      await expect(asUser(t.carol.id,
        `insert into messages (tenant_id, workspace_id, conversation_id, channel_id, direction, sender_type, body)
         values ($1, $2, $3, $4, 'in', 'contact', 'fake')`,
        [t.tenantA, t.a1, conversationId, channelA1])).rejects.toThrow(/row-level security/);
      await expect(asUser(t.carol.id,
        `insert into messages (tenant_id, workspace_id, conversation_id, channel_id, direction, sender_type, body, sender_id)
         values ($1, $2, $3, $4, 'out', 'user', 'x', $5)`,
        [t.tenantA, t.a1, conversationId, channelA1, t.mia.id])).rejects.toThrow(/permission denied/);
      await expect(asUser(t.carol.id,
        `insert into messages (tenant_id, workspace_id, conversation_id, channel_id, direction, sender_type, body, status)
         values ($1, $2, $3, $4, 'out', 'user', 'x', 'read')`,
        [t.tenantA, t.a1, conversationId, channelA1])).rejects.toThrow(/permission denied/);
    });

    it('mensagens são imutáveis para usuários', async () => {
      const [msg] = await sendText(t.carol.id, conversationId, 'Original');
      await expect(asUser(t.alice.id, `update messages set body = 'editada' where id = $1`, [msg!.id])).rejects.toThrow(/permission denied/);
      await expect(asUser(t.alice.id, `delete from messages where id = $1`, [msg!.id])).rejects.toThrow(/permission denied/);
    });

    it('mensagem precisa ser do mesmo canal da conversa', async () => {
      const otherChannel = await channelIn(db, t.a1);
      await expect(sendText(t.carol.id, conversationId, 'x', otherChannel)).rejects.toThrow(/foreign key/);
    });

    it('viewer não envia; outro tenant não lê', async () => {
      await expect(sendText(t.vic.id, conversationId)).rejects.toThrow(/row-level security/);
      expect(await asUser(t.vic.id, `select 1 from messages where conversation_id = $1`, [conversationId])).not.toHaveLength(0);
      expect(await asUser(t.bob.id, `select 1 from messages where conversation_id = $1`, [conversationId])).toHaveLength(0);
      expect(await asUser(t.bob.id, `select 1 from conversations where id = $1`, [conversationId])).toHaveLength(0);
    });

    it('excluir o contato apaga conversas e mensagens (LGPD)', async () => {
      const contact = await insertInWorkspace(db, t.a1, 'contacts', { name: 'Temporário' });
      const conv = await openConversation(t.carol.id, contact);
      await sendText(t.carol.id, conv);
      await asUser(t.mia.id, `delete from contacts where id = $1`, [contact]);
      expect(await db.query(`select 1 from conversations where id = $1`, [conv])).toHaveLength(0);
      expect(await db.query(`select 1 from messages where conversation_id = $1`, [conv])).toHaveLength(0);
    });
  });
});
