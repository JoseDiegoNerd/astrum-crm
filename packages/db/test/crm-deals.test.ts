import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultPipeline, insertInWorkspace, one, seedTenancy, type Tenancy } from '../src/testing/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../src/testing/harness.js';
import { describeWorkspaceTable } from './workspace-table-suite.js';

let seq = 0;

describeWorkspaceTable({
  table: 'pipelines',
  writers: 'manager',
  values: { name: 'Pós-venda' },
  update: { name: 'Pós-venda 2' },
});

describeWorkspaceTable({
  table: 'pipeline_stages',
  writers: 'manager',
  values: async (ws, db) => ({
    pipeline_id: (await defaultPipeline(db, ws.workspaceId)).id,
    name: `Etapa ${++seq}`,
    position: 10,
  }),
  update: { probability: 40 },
});

describeWorkspaceTable({
  table: 'deals',
  values: async (ws, db) => {
    const pipeline = await defaultPipeline(db, ws.workspaceId);
    return { title: 'Contrato anual', pipeline_id: pipeline.id, stage_id: pipeline.stages[0]!.id };
  },
  update: { title: 'Contrato anual (renovação)' },
});

describeWorkspaceTable({
  table: 'deal_tags',
  agentCanDelete: true,
  values: async (ws, db) => {
    const pipeline = await defaultPipeline(db, ws.workspaceId);
    return {
      deal_id: await insertInWorkspace(db, ws.workspaceId, 'deals', {
        title: 'Negócio',
        pipeline_id: pipeline.id,
        stage_id: pipeline.stages[0]!.id,
      }),
      tag_id: await insertInWorkspace(db, ws.workspaceId, 'tags', { name: `Tag ${++seq}` }),
    };
  },
});

describe('regras do funil', () => {
  let db: TestDatabase;
  let t: Tenancy;
  let pipelineA1: Awaited<ReturnType<typeof defaultPipeline>>;
  const stage = (name: string) => pipelineA1.stages.find((s) => s.name === name)!.id;

  const asCarol = <T>(sql: string, params?: unknown[]) => db.asUser(t.carol.id, (q) => q.query<T>(sql, params));
  const createDeal = async (stageName = 'Novo', extra: Record<string, unknown> = {}) => {
    const cols = ['tenant_id', 'workspace_id', 'title', 'pipeline_id', 'stage_id', ...Object.keys(extra)];
    const params = [t.tenantA, t.a1, 'Negócio', pipelineA1.id, stage(stageName), ...Object.values(extra)];
    const rows = await asCarol<{ id: string }>(
      `insert into deals (${cols.join(', ')}) values (${params.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
      params,
    );
    return rows[0]!.id;
  };
  const dealRow = (id: string) =>
    one<{ status: string; closed_at: Date | null; lost_reason: string | null }>(
      db,
      `select status, closed_at, lost_reason from deals where id = $1`,
      [id],
    );

  beforeAll(async () => {
    db = await createTestDatabase();
    t = await seedTenancy(db);
    pipelineA1 = await defaultPipeline(db, t.a1);
  });

  afterAll(async () => {
    await db?.close();
  });

  it('todo workspace nasce com o pipeline "Vendas" e 6 etapas', async () => {
    expect(pipelineA1.stages.map((s) => [s.name, s.kind])).toEqual([
      ['Novo', 'open'],
      ['Qualificado', 'open'],
      ['Proposta', 'open'],
      ['Negociação', 'open'],
      ['Ganho', 'won'],
      ['Perdido', 'lost'],
    ]);
    const created = await db.asUser(t.alice.id, (q) =>
      q.query<{ id: string }>(`insert into workspaces (tenant_id, name) values ($1, 'Nova filial') returning id`, [t.tenantA]),
    );
    expect((await defaultPipeline(db, created[0]!.id)).stages).toHaveLength(6);
  });

  it('só um pipeline padrão por workspace', async () => {
    await expect(db.asUser(t.mia.id, (q) =>
      q.query(`insert into pipelines (tenant_id, workspace_id, name, is_default) values ($1, $2, 'Outro', true)`,
        [t.tenantA, t.a1]),
    )).rejects.toThrow(/pipelines_one_default_key/);
  });

  it('status e data de fechamento seguem a etapa', async () => {
    const id = await createDeal();
    expect(await dealRow(id)).toMatchObject({ status: 'open', closed_at: null });

    await asCarol(`update deals set stage_id = $1 where id = $2`, [stage('Ganho'), id]);
    const won = await dealRow(id);
    expect(won.status).toBe('won');
    expect(won.closed_at).toBeInstanceOf(Date);

    await asCarol(`update deals set stage_id = $1, lost_reason = 'Preço' where id = $2`, [stage('Perdido'), id]);
    expect(await dealRow(id)).toMatchObject({ status: 'lost', lost_reason: 'Preço' });

    await asCarol(`update deals set stage_id = $1 where id = $2`, [stage('Proposta'), id]);
    expect(await dealRow(id)).toMatchObject({ status: 'open', closed_at: null, lost_reason: null });
  });

  it('negócio criado direto em "Ganho" já nasce fechado', async () => {
    const id = await createDeal('Ganho');
    expect((await dealRow(id)).status).toBe('won');
  });

  it('usuário não define status nem data de fechamento', async () => {
    const id = await createDeal();
    await expect(asCarol(`update deals set status = 'won' where id = $1`, [id])).rejects.toThrow(/permission denied/);
    await expect(asCarol(`update deals set closed_at = now() where id = $1`, [id])).rejects.toThrow(/permission denied/);
  });

  it('etapa precisa ser do pipeline do negócio', async () => {
    const other = (await db.asUser(t.mia.id, (q) => q.query<{ id: string }>(
      `insert into pipelines (tenant_id, workspace_id, name) values ($1, $2, 'Pós-venda') returning id`,
      [t.tenantA, t.a1],
    )))[0]!.id;
    const otherStage = (await db.asUser(t.mia.id, (q) => q.query<{ id: string }>(
      `insert into pipeline_stages (tenant_id, workspace_id, pipeline_id, name) values ($1, $2, $3, 'Onboarding') returning id`,
      [t.tenantA, t.a1, other],
    )))[0]!.id;
    await expect(createDeal('Novo', {})).resolves.toBeDefined();
    await expect(asCarol(
      `insert into deals (tenant_id, workspace_id, title, pipeline_id, stage_id) values ($1, $2, 'X', $3, $4)`,
      [t.tenantA, t.a1, pipelineA1.id, otherStage],
    )).rejects.toThrow(/foreign key/);
  });

  it('não apaga etapa nem pipeline que têm negócios', async () => {
    await createDeal('Qualificado');
    await expect(db.asUser(t.mia.id, (q) => q.query(`delete from pipeline_stages where id = $1`, [stage('Qualificado')])))
      .rejects.toThrow(/foreign key/);
    await expect(db.asUser(t.mia.id, (q) => q.query(`delete from pipelines where id = $1`, [pipelineA1.id])))
      .rejects.toThrow(/foreign key/);
  });

  it('não liga negócio a contato, empresa ou pipeline de outro workspace', async () => {
    const contactA2 = await insertInWorkspace(db, t.a2, 'contacts', { name: 'Filial' });
    const companyA2 = await insertInWorkspace(db, t.a2, 'companies', { name: 'Filial' });
    const pipelineA2 = await defaultPipeline(db, t.a2);
    await expect(createDeal('Novo', { contact_id: contactA2 })).rejects.toThrow(/foreign key/);
    await expect(createDeal('Novo', { company_id: companyA2 })).rejects.toThrow(/foreign key/);
    await expect(asCarol(
      `insert into deals (tenant_id, workspace_id, title, pipeline_id, stage_id) values ($1, $2, 'X', $3, $4)`,
      [t.tenantA, t.a1, pipelineA2.id, pipelineA2.stages[0]!.id],
    )).rejects.toThrow(/foreign key/);
  });

  it('valor não pode ser negativo e moeda segue ISO 4217', async () => {
    await expect(createDeal('Novo', { value_cents: -1 })).rejects.toThrow(/check/);
    await expect(createDeal('Novo', { currency: 'brl' })).rejects.toThrow(/check/);
    await expect(createDeal('Novo', { value_cents: 150000, currency: 'USD' })).resolves.toBeDefined();
  });

  it('apagar contato mantém o negócio, sem vínculo', async () => {
    const contact = await insertInWorkspace(db, t.a1, 'contacts', { name: 'Temporário' });
    const id = await createDeal('Novo', { contact_id: contact });
    await db.asUser(t.mia.id, (q) => q.query(`delete from contacts where id = $1`, [contact]));
    expect(await one<{ contact_id: string | null }>(db, `select contact_id from deals where id = $1`, [id]))
      .toEqual({ contact_id: null });
  });
});
