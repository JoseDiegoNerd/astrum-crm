import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultPipeline, seedTenancy, type Tenancy } from '../src/testing/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../src/testing/harness.js';

interface Activity {
  id: string;
  type: string;
  contact_id: string | null;
  deal_id: string | null;
  company_id: string | null;
  actor_id: string | null;
  payload: Record<string, unknown>;
}

describe('linha do tempo (activities)', () => {
  let db: TestDatabase;
  let t: Tenancy;
  let stages: Record<string, string>;
  let companyId: string;
  let contactId: string;
  let dealId: string;

  const asUser = <T>(userId: string, sql: string, params?: unknown[]) =>
    db.asUser(userId, (q) => q.query<T>(sql, params));
  const insertAs = async (userId: string, sql: string, params: unknown[]) =>
    (await asUser<{ id: string }>(userId, `${sql} returning id`, params))[0]!.id;
  const timeline = (column: string, id: string, userId = t.carol.id) =>
    asUser<Activity>(userId, `select * from activities where ${column} = $1 order by occurred_at, type`, [id]);
  const types = async (column: string, id: string) => (await timeline(column, id)).map((a) => a.type);

  beforeAll(async () => {
    db = await createTestDatabase();
    t = await seedTenancy(db);
    const pipeline = await defaultPipeline(db, t.a1);
    stages = Object.fromEntries(pipeline.stages.map((s) => [s.name, s.id]));

    companyId = await insertAs(t.carol.id, `insert into companies (tenant_id, workspace_id, name) values ($1, $2, 'Padaria Sol')`, [t.tenantA, t.a1]);
    contactId = await insertAs(
      t.carol.id,
      `insert into contacts (tenant_id, workspace_id, name, company_id) values ($1, $2, 'Ana', $3)`,
      [t.tenantA, t.a1, companyId],
    );
    dealId = await insertAs(
      t.carol.id,
      `insert into deals (tenant_id, workspace_id, title, pipeline_id, stage_id, contact_id, company_id, value_cents)
       values ($1, $2, 'Plano anual', $3, $4, $5, $6, 120000)`,
      [t.tenantA, t.a1, pipeline.id, stages['Novo'], contactId, companyId],
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  it('registra criação de empresa, contato e negócio com autor e dados', async () => {
    const events = await timeline('contact_id', contactId);
    expect(events.map((e) => e.type)).toEqual(['contact.created', 'deal.created']);
    expect(events[0]).toMatchObject({ actor_id: t.carol.id, company_id: companyId, payload: { name: 'Ana' } });
    expect(events[1]!.payload).toMatchObject({ title: 'Plano anual', stage: 'Novo', value_cents: 120000 });
    expect(await types('company_id', companyId)).toEqual(['company.created', 'contact.created', 'deal.created']);
  });

  it('registra mudança de etapa, ganho e perda com motivo', async () => {
    await asUser(t.carol.id, `update deals set stage_id = $1 where id = $2`, [stages['Proposta'], dealId]);
    await asUser(t.carol.id, `update deals set title = 'Plano anual 2026' where id = $1`, [dealId]); // não é evento
    await asUser(t.carol.id, `update deals set stage_id = $1, lost_reason = 'Preço' where id = $2`, [stages['Perdido'], dealId]);
    await asUser(t.carol.id, `update deals set stage_id = $1 where id = $2`, [stages['Ganho'], dealId]);

    const events = (await timeline('deal_id', dealId)).filter((e) => e.type !== 'deal.created');
    expect(events.map((e) => [e.type, e.payload.from, e.payload.to])).toEqual([
      ['deal.stage_changed', 'Novo', 'Proposta'],
      ['deal.lost', 'Proposta', 'Perdido'],
      ['deal.won', 'Perdido', 'Ganho'],
    ]);
    expect(events[1]!.payload.reason).toBe('Preço');
  });

  it('registra tarefa criada e concluída (só a primeira conclusão) e nota', async () => {
    const taskId = await insertAs(
      t.carol.id,
      `insert into tasks (tenant_id, workspace_id, title, contact_id) values ($1, $2, 'Ligar', $3)`,
      [t.tenantA, t.a1, contactId],
    );
    await asUser(t.carol.id, `update tasks set done_at = now() where id = $1`, [taskId]);
    await asUser(t.carol.id, `update tasks set title = 'Ligar de novo' where id = $1`, [taskId]); // não é evento
    await asUser(t.carol.id, `insert into notes (tenant_id, workspace_id, contact_id, body) values ($1, $2, $3, $4)`,
      [t.tenantA, t.a1, contactId, 'Cliente pediu desconto. '.repeat(20)]);

    const events = await timeline('contact_id', contactId);
    const tail = events.slice(-3);
    expect(tail.map((e) => e.type)).toEqual(['task.created', 'task.completed', 'note.added']);
    expect((tail[2]!.payload.excerpt as string).length).toBe(200);
  });

  it('usuários não inserem, alteram nem apagam eventos', async () => {
    await expect(asUser(t.alice.id,
      `insert into activities (tenant_id, workspace_id, type, contact_id) values ($1, $2, 'note.added', $3)`,
      [t.tenantA, t.a1, contactId],
    )).rejects.toThrow(/permission denied/);
    await expect(asUser(t.alice.id, `update activities set payload = '{}' where contact_id = $1`, [contactId]))
      .rejects.toThrow(/permission denied/);
    await expect(asUser(t.alice.id, `delete from activities where contact_id = $1`, [contactId]))
      .rejects.toThrow(/permission denied/);
    await expect(asUser(t.alice.id, `select private.log_activity($1, $2, 'note.added', null, null, null, '{}')`,
      [t.tenantA, t.a1])).rejects.toThrow(/permission denied/);
  });

  it('só quem acessa o workspace vê os eventos', async () => {
    expect((await timeline('contact_id', contactId, t.vic.id)).length).toBeGreaterThan(0);
    expect(await timeline('contact_id', contactId, t.bob.id)).toEqual([]);
    expect(await asUser(t.bob.id, `select 1 from activities`)).toEqual([]);
    // carol não está em A2: não vê eventos criados lá
    await insertAs(t.alice.id, `insert into contacts (tenant_id, workspace_id, name) values ($1, $2, 'Filial')`, [t.tenantA, t.a2]);
    const visibleToCarol = await asUser<{ workspace_id: string }>(t.carol.id, `select distinct workspace_id from activities`);
    expect(visibleToCarol.map((r) => r.workspace_id)).toEqual([t.a1]);
  });

  it('excluir o negócio mantém o histórico no contato; excluir o contato apaga o dele', async () => {
    await asUser(t.mia.id, `delete from deals where id = $1`, [dealId]);
    const afterDeal = await timeline('contact_id', contactId);
    const dealEvents = afterDeal.filter((e) => e.type.startsWith('deal.'));
    expect(dealEvents.length).toBeGreaterThan(0);
    expect(dealEvents.every((e) => e.deal_id === null && e.payload.title)).toBe(true);

    await asUser(t.mia.id, `delete from contacts where id = $1`, [contactId]);
    expect(await db.query(`select 1 from activities where contact_id = $1`, [contactId])).toEqual([]);
    // eventos só da empresa continuam
    expect(await types('company_id', companyId)).toEqual(['company.created']);
  });
});
