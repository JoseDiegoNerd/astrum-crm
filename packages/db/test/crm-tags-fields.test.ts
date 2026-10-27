import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { one, seedTenancy, type Tenancy } from '../src/testing/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../src/testing/harness.js';
import { describeWorkspaceTable, type WorkspaceRef } from './workspace-table-suite.js';

// Pré-requisitos criados como superusuário; o tenant vem do próprio workspace.
let seq = 0;
async function insertIn(db: TestDatabase, ws: WorkspaceRef, table: string, columns: Record<string, unknown>) {
  const cols = Object.keys(columns);
  const placeholders = cols.map((_, i) => `$${i + 2}`).join(', ');
  return (
    await one<{ id: string }>(
      db,
      `insert into ${table} (tenant_id, workspace_id, ${cols.join(', ')})
       select tenant_id, id, ${placeholders} from workspaces where id = $1
       returning id`,
      [ws.workspaceId, ...Object.values(columns)],
    )
  ).id;
}

describeWorkspaceTable({
  table: 'tags',
  writers: 'manager',
  values: async () => ({ name: `Tag ${++seq}` }),
  update: { color: '#22c55e' },
});

describeWorkspaceTable({
  table: 'custom_field_defs',
  writers: 'manager',
  values: async () => ({ entity: 'contact', key: `campo_${++seq}`, label: 'Origem', type: 'text' }),
  update: { label: 'Origem do lead' },
});

describeWorkspaceTable({
  table: 'contact_tags',
  agentCanDelete: true,
  values: async (ws, db) => ({
    contact_id: await insertIn(db, ws, 'contacts', { name: 'Contato' }),
    tag_id: await insertIn(db, ws, 'tags', { name: `Tag ${++seq}` }),
  }),
});

describeWorkspaceTable({
  table: 'company_tags',
  agentCanDelete: true,
  values: async (ws, db) => ({
    company_id: await insertIn(db, ws, 'companies', { name: 'Empresa' }),
    tag_id: await insertIn(db, ws, 'tags', { name: `Tag ${++seq}` }),
  }),
});

describe('regras de tags e campos customizados', () => {
  let db: TestDatabase;
  let t: Tenancy;
  let contactA1: string;
  let vipA1: string;

  const asMia = <T>(sql: string, params?: unknown[]) => db.asUser(t.mia.id, (q) => q.query<T>(sql, params));
  const asCarol = <T>(sql: string, params?: unknown[]) => db.asUser(t.carol.id, (q) => q.query<T>(sql, params));
  const field = (entity: string, key: string, type: string, options: unknown[] = []) =>
    asMia(
      `insert into custom_field_defs (tenant_id, workspace_id, entity, key, label, type, options)
       values ($1, $2, $3, $4, $4, $5, $6)`,
      [t.tenantA, t.a1, entity, key, type, JSON.stringify(options)],
    );

  beforeAll(async () => {
    db = await createTestDatabase();
    t = await seedTenancy(db);
    contactA1 = await insertIn(db, { tenantId: t.tenantA, workspaceId: t.a1 }, 'contacts', { name: 'Ana' });
    vipA1 = (await asMia<{ id: string }>(
      `insert into tags (tenant_id, workspace_id, name) values ($1, $2, 'VIP') returning id`,
      [t.tenantA, t.a1],
    ))[0]!.id;
  });

  afterAll(async () => {
    await db?.close();
  });

  it('nome de tag é único no workspace, sem diferenciar maiúsculas', async () => {
    await expect(asMia(`insert into tags (tenant_id, workspace_id, name) values ($1, $2, 'vip')`, [t.tenantA, t.a1]))
      .rejects.toThrow(/tags_workspace_name_key/);
  });

  it('cor da tag precisa ser hexadecimal', async () => {
    await expect(asMia(`update tags set color = 'red' where id = $1`, [vipA1])).rejects.toThrow(/check/);
  });

  it('agent aplica e remove tag; não aplica tag de outro workspace', async () => {
    await asCarol(`insert into contact_tags (tenant_id, workspace_id, contact_id, tag_id) values ($1, $2, $3, $4)`,
      [t.tenantA, t.a1, contactA1, vipA1]);
    await expect(asCarol(
      `insert into contact_tags (tenant_id, workspace_id, contact_id, tag_id) values ($1, $2, $3, $4)`,
      [t.tenantA, t.a1, contactA1, vipA1],
    )).rejects.toThrow(/unique/);

    const tagA2 = await insertIn(db, { tenantId: t.tenantA, workspaceId: t.a2 }, 'tags', { name: 'Filial' });
    await expect(db.asUser(t.alice.id, (q) => q.query(
      `insert into contact_tags (tenant_id, workspace_id, contact_id, tag_id) values ($1, $2, $3, $4)`,
      [t.tenantA, t.a1, contactA1, tagA2],
    ))).rejects.toThrow(/foreign key/);
  });

  it('apagar a tag remove as aplicações', async () => {
    const temp = (await asMia<{ id: string }>(
      `insert into tags (tenant_id, workspace_id, name) values ($1, $2, 'Temporária') returning id`,
      [t.tenantA, t.a1],
    ))[0]!.id;
    await asCarol(`insert into contact_tags (tenant_id, workspace_id, contact_id, tag_id) values ($1, $2, $3, $4)`,
      [t.tenantA, t.a1, contactA1, temp]);
    await asMia(`delete from tags where id = $1`, [temp]);
    expect(await db.query(`select 1 from contact_tags where tag_id = $1`, [temp])).toHaveLength(0);
  });

  it('select/multiselect exigem opções; os demais tipos não aceitam', async () => {
    await expect(field('contact', 'segmento', 'select')).rejects.toThrow(/options_check/);
    await expect(field('contact', 'nota', 'text', ['a'])).rejects.toThrow(/options_check/);
    await expect(field('contact', 'segmento', 'select', ['Varejo', 'Indústria'])).resolves.toBeDefined();
  });

  it('chave do campo segue o formato snake_case e é única por entidade', async () => {
    await expect(field('contact', 'Data Nascimento', 'date')).rejects.toThrow(/check/);
    await field('company', 'segmento', 'select', ['A']);
    await expect(field('contact', 'segmento', 'select', ['A'])).rejects.toThrow(/unique/);
  });

  it('chave, entidade e tipo do campo são imutáveis', async () => {
    for (const column of ['key', 'entity', 'type']) {
      const value = column === 'key' ? 'outro' : column === 'entity' ? 'company' : 'number';
      await expect(asMia(`update custom_field_defs set ${column} = $1 where key = 'segmento' and entity = 'contact'`, [value]))
        .rejects.toThrow(/permission denied/);
    }
  });
});
