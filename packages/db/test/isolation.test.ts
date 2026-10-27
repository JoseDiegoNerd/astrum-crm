import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type Queryable, type TestDatabase, type TestUser } from './harness.js';

// Cenário:
//   Tenant A (alice owner, dave admin, carol member)
//     ├─ workspace A1 "Principal"  ← carol é agent aqui
//     └─ workspace A2 "Filial"
//   Tenant B (bob owner)
//     └─ workspace B1 "Principal"

let db: TestDatabase;
let alice: TestUser, bob: TestUser, carol: TestUser, dave: TestUser;
let tenantA: string, tenantB: string;
let a1: string, a2: string, b1: string;

const one = async <T>(q: Queryable, text: string, params?: unknown[]) => (await q.query<T>(text, params))[0]!;
const ids = async (q: Queryable, text: string, params?: unknown[]) =>
  (await q.query<{ id: string }>(text, params)).map((r) => r.id).sort();
const sorted = (...values: string[]) => [...values].sort();

beforeAll(async () => {
  db = await createTestDatabase();
  [alice, bob, carol, dave] = await Promise.all(
    ['alice@a.test', 'bob@b.test', 'carol@a.test', 'dave@a.test'].map((e) => db.createUser(e)),
  ) as [TestUser, TestUser, TestUser, TestUser];

  tenantA = await db.asUser(alice.id, async (q) =>
    (await one<{ id: string }>(q, `select id from private.create_tenant('Empresa A')`)).id);
  tenantB = await db.asUser(bob.id, async (q) =>
    (await one<{ id: string }>(q, `select id from private.create_tenant('Empresa B')`)).id);

  await db.asUser(alice.id, async (q) => {
    a1 = (await one<{ id: string }>(q, `select id from workspaces where tenant_id = $1`, [tenantA])).id;
    a2 = (await one<{ id: string }>(q,
      `insert into workspaces (tenant_id, name) values ($1, 'Filial') returning id`, [tenantA])).id;
    await q.query(`select private.add_tenant_member_by_email($1, $2, 'member')`, [tenantA, carol.email]);
    await q.query(`select private.add_tenant_member_by_email($1, $2, 'admin')`, [tenantA, dave.email]);
    await q.query(
      `insert into workspace_members (tenant_id, workspace_id, user_id, role) values ($1, $2, $3, 'agent')`,
      [tenantA, a1, carol.id]);
  });
  b1 = await db.asUser(bob.id, async (q) =>
    (await one<{ id: string }>(q, `select id from workspaces where tenant_id = $1`, [tenantB])).id);
});

afterAll(async () => {
  await db?.close();
});

describe('onboarding', () => {
  it('cria tenant com owner e workspace inicial', async () => {
    await db.asUser(alice.id, async (q) => {
      const m = await one<{ role: string }>(q,
        `select role from memberships where tenant_id = $1 and user_id = $2`, [tenantA, alice.id]);
      expect(m.role).toBe('owner');
      const w = await one<{ name: string; slug: string }>(q, `select name, slug from workspaces where id = $1`, [a1]);
      expect(w.name).toBe('Principal');
      expect(w.slug).toMatch(/^principal-[0-9a-f]{6}$/);
    });
  });

  it('cria perfil automaticamente para novo usuário do Auth', async () => {
    const p = await one<{ email: string }>(db, `select email from profiles where id = $1`, [alice.id]);
    expect(p.email).toBe(alice.email);
  });

  it('exige usuário autenticado para criar tenant', async () => {
    await expect(db.asAnon((q) => q.query(`select private.create_tenant('X')`))).rejects.toThrow();
  });
});

describe('isolamento entre tenants', () => {
  it('cada owner só enxerga o próprio tenant', async () => {
    expect(await db.asUser(alice.id, (q) => ids(q, `select id from tenants`))).toEqual([tenantA]);
    expect(await db.asUser(bob.id, (q) => ids(q, `select id from tenants`))).toEqual([tenantB]);
  });

  it('não vê workspaces, memberships nem perfis de outro tenant', async () => {
    await db.asUser(bob.id, async (q) => {
      expect(await ids(q, `select id from workspaces`)).toEqual([b1]);
      expect(await q.query(`select 1 from memberships where tenant_id = $1`, [tenantA])).toHaveLength(0);
      expect(await q.query(`select 1 from profiles where id = $1`, [alice.id])).toHaveLength(0);
      expect(await q.query(`select 1 from workspace_members where tenant_id = $1`, [tenantA])).toHaveLength(0);
    });
  });

  it('não cria workspace em outro tenant', async () => {
    await expect(db.asUser(bob.id, (q) =>
      q.query(`insert into workspaces (tenant_id, name) values ($1, 'Invasão')`, [tenantA]),
    )).rejects.toThrow(/row-level security/);
  });

  it('não altera nem apaga dados de outro tenant', async () => {
    await db.asUser(bob.id, async (q) => {
      expect(await q.query(`update tenants set name = 'hack' where id = $1 returning id`, [tenantA])).toHaveLength(0);
      expect(await q.query(`update workspaces set name = 'hack' where id = $1 returning id`, [a1])).toHaveLength(0);
      expect(await q.query(`delete from workspaces where id = $1 returning id`, [a1])).toHaveLength(0);
    });
    const w = await one<{ name: string }>(db, `select name from workspaces where id = $1`, [a1]);
    expect(w.name).toBe('Principal');
  });

  it('não se adiciona como membro de outro tenant', async () => {
    await expect(db.asUser(bob.id, (q) =>
      q.query(`insert into memberships (tenant_id, user_id, role) values ($1, $2, 'owner')`, [tenantA, bob.id]),
    )).rejects.toThrow(/row-level security/);
    await expect(db.asUser(bob.id, (q) =>
      q.query(`select private.add_tenant_member_by_email($1, $2)`, [tenantA, bob.email]),
    )).rejects.toThrow(/Sem permissão/);
  });

  it('não move workspace para outro tenant', async () => {
    await expect(db.asUser(alice.id, (q) =>
      q.query(`update workspaces set tenant_id = $1 where id = $2`, [tenantB, a2]),
    )).rejects.toThrow(/permission denied/);
  });

  it('não adiciona ao workspace usuário de fora do tenant', async () => {
    await expect(db.asUser(alice.id, (q) =>
      q.query(`insert into workspace_members (tenant_id, workspace_id, user_id) values ($1, $2, $3)`,
        [tenantA, a1, bob.id]),
    )).rejects.toThrow(/foreign key/);
  });

  it('não liga workspace de um tenant a outro tenant', async () => {
    await expect(db.asUser(alice.id, (q) =>
      q.query(`insert into workspace_members (tenant_id, workspace_id, user_id) values ($1, $2, $3)`,
        [tenantA, b1, alice.id]),
    )).rejects.toThrow();
  });
});

describe('isolamento entre workspaces', () => {
  it('member só vê os workspaces em que foi incluído', async () => {
    expect(await db.asUser(carol.id, (q) => ids(q, `select id from workspaces`))).toEqual([a1]);
  });

  it('owner e admin veem todos os workspaces do tenant', async () => {
    expect(await db.asUser(alice.id, (q) => ids(q, `select id from workspaces`))).toEqual(sorted(a1, a2));
    expect(await db.asUser(dave.id, (q) => ids(q, `select id from workspaces`))).toEqual(sorted(a1, a2));
  });

  it('member não cria workspace', async () => {
    await expect(db.asUser(carol.id, (q) =>
      q.query(`insert into workspaces (tenant_id, name) values ($1, 'Meu')`, [tenantA]),
    )).rejects.toThrow(/row-level security/);
  });

  it('agent não gerencia a equipe do workspace', async () => {
    await expect(db.asUser(carol.id, (q) =>
      q.query(`insert into workspace_members (tenant_id, workspace_id, user_id) values ($1, $2, $3)`,
        [tenantA, a1, dave.id]),
    )).rejects.toThrow(/row-level security/);
    expect(await db.asUser(carol.id, (q) =>
      q.query(`update workspace_members set role = 'manager' where user_id = $1 returning id`, [carol.id]),
    )).toHaveLength(0);
  });
});

describe('papéis no tenant', () => {
  it('member não se promove', async () => {
    expect(await db.asUser(carol.id, (q) =>
      q.query(`update memberships set role = 'admin' where user_id = $1 returning id`, [carol.id]),
    )).toHaveLength(0);
  });

  it('admin não se promove a owner', async () => {
    await expect(db.asUser(dave.id, (q) =>
      q.query(`update memberships set role = 'owner' where tenant_id = $1 and user_id = $2`, [tenantA, dave.id]),
    )).rejects.toThrow(/row-level security/);
  });

  it('admin cria workspace', async () => {
    const w = await db.asUser(dave.id, (q) =>
      one<{ id: string }>(q, `insert into workspaces (tenant_id, name) values ($1, 'Do Dave') returning id`, [tenantA]));
    expect(w.id).toBeTruthy();
  });

  it('o último owner não pode sair nem ser rebaixado', async () => {
    await expect(db.asUser(alice.id, (q) =>
      q.query(`delete from memberships where tenant_id = $1 and user_id = $2`, [tenantA, alice.id]),
    )).rejects.toThrow(/owner ativo/);
    await expect(db.asUser(alice.id, (q) =>
      q.query(`update memberships set role = 'admin' where tenant_id = $1 and user_id = $2`, [tenantA, alice.id]),
    )).rejects.toThrow(/owner ativo/);
  });

  it('membership suspensa perde o acesso', async () => {
    const other = await db.createUser('erin@a.test');
    await db.asUser(alice.id, async (q) => {
      await q.query(`select private.add_tenant_member_by_email($1, $2, 'admin')`, [tenantA, other.email]);
    });
    expect(await db.asUser(other.id, (q) => ids(q, `select id from tenants`))).toEqual([tenantA]);

    await db.asUser(alice.id, (q) =>
      q.query(`update memberships set status = 'suspended' where tenant_id = $1 and user_id = $2`, [tenantA, other.id]));

    await db.asUser(other.id, async (q) => {
      expect(await q.query(`select 1 from tenants`)).toHaveLength(0);
      expect(await q.query(`select 1 from workspaces`)).toHaveLength(0);
    });
  });
});

describe('acesso anônimo', () => {
  it.each(['profiles', 'tenants', 'memberships', 'workspaces', 'workspace_members'])(
    'anon não lê %s',
    async (table) => {
      await expect(db.asAnon((q) => q.query(`select 1 from ${table}`))).rejects.toThrow(/permission denied/);
    },
  );

  it('anon não acessa o schema private', async () => {
    await expect(db.asAnon((q) => q.query(`select private.is_tenant_member(gen_random_uuid())`)))
      .rejects.toThrow(/permission denied/);
  });
});
