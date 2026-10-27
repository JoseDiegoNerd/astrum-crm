import type { Queryable, TestDatabase, TestUser } from './harness.js';

/**
 * Cenário padrão de tenancy usado pelos testes:
 *
 *   Tenant A (alice owner, dave admin, carol/vic/mia member)
 *     ├─ workspace A1 "Principal"  ← carol agent, vic viewer, mia manager
 *     └─ workspace A2 "Filial"
 *   Tenant B (bob owner)
 *     └─ workspace B1 "Principal"
 */
export interface Tenancy {
  alice: TestUser;
  bob: TestUser;
  carol: TestUser;
  dave: TestUser;
  vic: TestUser;
  mia: TestUser;
  tenantA: string;
  tenantB: string;
  a1: string;
  a2: string;
  b1: string;
}

export const one = async <T>(q: Queryable, text: string, params?: unknown[]) =>
  (await q.query<T>(text, params))[0]!;

export const ids = async (q: Queryable, text: string, params?: unknown[]) =>
  (await q.query<{ id: string }>(text, params)).map((r) => r.id).sort();

/**
 * Insere uma linha numa tabela de workspace como superusuário (pré-requisitos de
 * testes). O tenant vem do próprio workspace, para a linha ser sempre válida.
 */
export async function insertInWorkspace(
  db: Queryable,
  workspaceId: string,
  table: string,
  columns: Record<string, unknown>,
): Promise<string> {
  const cols = Object.keys(columns);
  const placeholders = cols.map((_, i) => `$${i + 2}`).join(', ');
  const row = await one<{ id: string }>(
    db,
    `insert into ${table} (tenant_id, workspace_id, ${cols.join(', ')})
     select tenant_id, id, ${placeholders} from workspaces where id = $1
     returning id`,
    [workspaceId, ...Object.values(columns)],
  );
  return row.id;
}

/** Pipeline padrão do workspace e suas etapas, na ordem. */
export async function defaultPipeline(db: Queryable, workspaceId: string) {
  const pipeline = await one<{ id: string }>(
    db,
    `select id from pipelines where workspace_id = $1 and is_default`,
    [workspaceId],
  );
  const stages = await db.query<{ id: string; name: string; kind: string }>(
    `select id, name, kind from pipeline_stages where pipeline_id = $1 order by position`,
    [pipeline.id],
  );
  return { id: pipeline.id, stages };
}

export async function seedTenancy(db: TestDatabase): Promise<Tenancy> {
  const [alice, bob, carol, dave, vic, mia] = (await Promise.all(
    ['alice@a.test', 'bob@b.test', 'carol@a.test', 'dave@a.test', 'vic@a.test', 'mia@a.test'].map((e) =>
      db.createUser(e),
    ),
  )) as [TestUser, TestUser, TestUser, TestUser, TestUser, TestUser];

  const tenantA = await db.asUser(alice.id, async (q) =>
    (await one<{ id: string }>(q, `select id from private.create_tenant('Empresa A')`)).id);
  const tenantB = await db.asUser(bob.id, async (q) =>
    (await one<{ id: string }>(q, `select id from private.create_tenant('Empresa B')`)).id);

  const { a1, a2 } = await db.asUser(alice.id, async (q) => {
    const a1 = (await one<{ id: string }>(q, `select id from workspaces where tenant_id = $1`, [tenantA])).id;
    const a2 = (await one<{ id: string }>(q,
      `insert into workspaces (tenant_id, name) values ($1, 'Filial') returning id`, [tenantA])).id;
    await q.query(`select private.add_tenant_member_by_email($1, $2, 'member')`, [tenantA, carol.email]);
    await q.query(`select private.add_tenant_member_by_email($1, $2, 'admin')`, [tenantA, dave.email]);
    await q.query(`select private.add_tenant_member_by_email($1, $2, 'member')`, [tenantA, vic.email]);
    await q.query(`select private.add_tenant_member_by_email($1, $2, 'member')`, [tenantA, mia.email]);
    await q.query(
      `insert into workspace_members (tenant_id, workspace_id, user_id, role)
       values ($1, $2, $3, 'agent'), ($1, $2, $4, 'viewer'), ($1, $2, $5, 'manager')`,
      [tenantA, a1, carol.id, vic.id, mia.id]);
    return { a1, a2 };
  });
  const b1 = await db.asUser(bob.id, async (q) =>
    (await one<{ id: string }>(q, `select id from workspaces where tenant_id = $1`, [tenantB])).id);

  return { alice, bob, carol, dave, vic, mia, tenantA, tenantB, a1, a2, b1 };
}
