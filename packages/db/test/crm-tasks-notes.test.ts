import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultPipeline, insertInWorkspace, one, seedTenancy, type Tenancy } from '../src/testing/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../src/testing/harness.js';
import { describeWorkspaceTable } from './workspace-table-suite.js';

describeWorkspaceTable({
  table: 'tasks',
  values: { title: 'Ligar para o cliente' },
  update: { title: 'Ligar para o cliente amanhã' },
});

describeWorkspaceTable({
  table: 'notes',
  values: async (ws, db) => ({
    contact_id: await insertInWorkspace(db, ws.workspaceId, 'contacts', { name: 'Contato' }),
    body: 'Prefere contato à tarde.',
  }),
  update: { body: 'Prefere contato pela manhã.' },
});

describe('regras de tarefas e notas', () => {
  let db: TestDatabase;
  let t: Tenancy;
  let contactA1: string;

  const asUser = <T>(userId: string, sql: string, params?: unknown[]) =>
    db.asUser(userId, (q) => q.query<T>(sql, params));

  beforeAll(async () => {
    db = await createTestDatabase();
    t = await seedTenancy(db);
    contactA1 = await insertInWorkspace(db, t.a1, 'contacts', { name: 'Ana' });
  });

  afterAll(async () => {
    await db?.close();
  });

  it('agent conclui e reabre tarefa', async () => {
    const [task] = await asUser<{ id: string }>(
      t.carol.id,
      `insert into tasks (tenant_id, workspace_id, title, assignee_id) values ($1, $2, 'Enviar proposta', $3) returning id`,
      [t.tenantA, t.a1, t.carol.id],
    );
    expect(await asUser(t.carol.id, `update tasks set done_at = now() where id = $1 returning id`, [task!.id])).toHaveLength(1);
    expect(await asUser(t.carol.id, `update tasks set done_at = null where id = $1 returning id`, [task!.id])).toHaveLength(1);
  });

  it('responsável precisa ser membro da conta', async () => {
    await expect(asUser(
      t.carol.id,
      `insert into tasks (tenant_id, workspace_id, title, assignee_id) values ($1, $2, 'X', $3)`,
      [t.tenantA, t.a1, t.bob.id],
    )).rejects.toThrow(/foreign key/);
  });

  it('tarefa não se liga a registros de outro workspace e sobrevive à exclusão do vínculo', async () => {
    const contactA2 = await insertInWorkspace(db, t.a2, 'contacts', { name: 'Filial' });
    await expect(asUser(
      t.carol.id,
      `insert into tasks (tenant_id, workspace_id, title, contact_id) values ($1, $2, 'X', $3)`,
      [t.tenantA, t.a1, contactA2],
    )).rejects.toThrow(/foreign key/);

    const pipeline = await defaultPipeline(db, t.a1);
    const deal = await insertInWorkspace(db, t.a1, 'deals', {
      title: 'Negócio', pipeline_id: pipeline.id, stage_id: pipeline.stages[0]!.id,
    });
    const [task] = await asUser<{ id: string }>(
      t.carol.id,
      `insert into tasks (tenant_id, workspace_id, title, deal_id) values ($1, $2, 'Follow-up', $3) returning id`,
      [t.tenantA, t.a1, deal],
    );
    await asUser(t.mia.id, `delete from deals where id = $1`, [deal]);
    expect(await one<{ deal_id: string | null }>(db, `select deal_id from tasks where id = $1`, [task!.id]))
      .toEqual({ deal_id: null });
  });

  it('nota precisa de um assunto', async () => {
    await expect(asUser(
      t.carol.id,
      `insert into notes (tenant_id, workspace_id, body) values ($1, $2, 'Solta')`,
      [t.tenantA, t.a1],
    )).rejects.toThrow(/notes_subject_check/);
  });

  it('só o autor edita a nota — nem manager nem owner editam a de outro', async () => {
    const [note] = await asUser<{ id: string }>(
      t.carol.id,
      `insert into notes (tenant_id, workspace_id, contact_id, body) values ($1, $2, $3, 'Original') returning id`,
      [t.tenantA, t.a1, contactA1],
    );
    for (const other of [t.mia.id, t.alice.id]) {
      expect(await asUser(other, `update notes set body = 'Alterada' where id = $1 returning id`, [note!.id])).toHaveLength(0);
    }
    expect(await asUser(t.carol.id, `update notes set body = 'Revisada' where id = $1 returning id`, [note!.id])).toHaveLength(1);
  });

  it('assunto da nota não muda depois de criada', async () => {
    const [note] = await asUser<{ id: string }>(
      t.carol.id,
      `insert into notes (tenant_id, workspace_id, contact_id, body) values ($1, $2, $3, 'X') returning id`,
      [t.tenantA, t.a1, contactA1],
    );
    await expect(asUser(t.carol.id, `update notes set contact_id = null where id = $1`, [note!.id]))
      .rejects.toThrow(/permission denied/);
  });

  it('notas somem junto com o contato', async () => {
    const temp = await insertInWorkspace(db, t.a1, 'contacts', { name: 'Temporário' });
    await asUser(t.carol.id, `insert into notes (tenant_id, workspace_id, contact_id, body) values ($1, $2, $3, 'Y')`,
      [t.tenantA, t.a1, temp]);
    await asUser(t.mia.id, `delete from contacts where id = $1`, [temp]);
    expect(await db.query(`select 1 from notes where contact_id = $1`, [temp])).toHaveLength(0);
  });
});
