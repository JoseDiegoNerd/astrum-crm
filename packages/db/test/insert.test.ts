import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertSql, mapRow } from '../src/insert.js';
import { contactIdentities, contacts } from '../src/schema.js';
import { seedTenancy, type Tenancy } from '../src/testing/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../src/testing/harness.js';

// Roda o SQL gerado pelo helper como um usuário comum, sob RLS e grants por coluna.
describe('insertSql', () => {
  const dialect = new PgDialect();
  let db: TestDatabase;
  let t: Tenancy;

  beforeAll(async () => {
    db = await createTestDatabase();
    t = await seedTenancy(db);
  });

  afterAll(async () => {
    await db?.close();
  });

  const run = (userId: string, query: ReturnType<typeof insertSql>) => {
    const { sql, params } = dialect.sqlToQuery(query);
    return db.asUser(userId, (q) => q.query<Record<string, unknown>>(sql, params));
  };

  it('lista só as colunas informadas', () => {
    const { sql } = dialect.sqlToQuery(insertSql(contacts, { tenantId: 'a', workspaceId: 'b', name: 'x' }));
    expect(sql).toBe('insert into "contacts" ("tenant_id", "workspace_id", "name") values ($1, $2, $3) returning *');
  });

  it('insere sob grants por coluna e devolve a linha mapeada', async () => {
    const [raw] = await run(
      t.carol.id,
      insertSql(contacts, { tenantId: t.tenantA, workspaceId: t.a1, name: 'Ana', custom: { origem: 'site' } }),
    );
    const row = mapRow(contacts, raw!);
    expect(row).toMatchObject({ name: 'Ana', type: 'lead', createdBy: t.carol.id, custom: { origem: 'site' } });
    expect(row.createdAt).toBeInstanceOf(Date);

    const [identity] = await run(
      t.carol.id,
      insertSql(contactIdentities, {
        tenantId: t.tenantA,
        workspaceId: t.a1,
        contactId: row.id,
        channel: 'email',
        identifier: 'ana@exemplo.com',
      }),
    );
    expect(mapRow(contactIdentities, identity!)).toMatchObject({ channel: 'email', verified: false });
  });

  it('ignora valores undefined e recusa coluna desconhecida', () => {
    const { sql } = dialect.sqlToQuery(
      insertSql(contacts, { tenantId: 'a', workspaceId: 'b', name: 'x', companyId: undefined }),
    );
    expect(sql).not.toContain('company_id');
    expect(() => insertSql(contacts, { nope: 1 } as never)).toThrow(/desconhecida/);
  });
});
