import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, one, seedTenancy, type Tenancy } from './fixtures.js';
import { createTestDatabase, type Queryable, type TestDatabase } from './harness.js';

export interface WorkspaceTableSpec {
  /** Nome da tabela em public. */
  table: string;
  /** Colunas de negócio válidas para um INSERT (sem tenant_id/workspace_id). */
  values: Record<string, unknown>;
  /** Alteração válida de uma coluna editável. */
  update: Record<string, unknown>;
  /** Roda antes do seed (ex.: criar a tabela num teste de template). */
  setup?: (db: TestDatabase) => Promise<void>;
  teardown?: (db: TestDatabase) => Promise<void>;
  /** A tabela tem created_by preenchido por auth.uid()? (padrão: true) */
  hasCreatedBy?: boolean;
}

/**
 * Suíte de isolamento obrigatória para toda tabela de negócio de workspace.
 * Verifica o padrão do template packages/db/templates/workspace-table.sql:
 * viewer lê · agent cria/edita · manager (e owner/admin) apaga · ninguém de fora vê nada.
 *
 *   describeWorkspaceTable({ table: 'contacts', values: { name: 'Ana' }, update: { name: 'Ana B.' } });
 */
export function describeWorkspaceTable(spec: WorkspaceTableSpec) {
  const { table } = spec;
  const columns = Object.keys(spec.values);
  const setClause = Object.keys(spec.update).map((c, i) => `${c} = $${i + 2}`).join(', ');

  const insert = (q: Queryable, tenantId: string, workspaceId: string, extra: Record<string, unknown> = {}) => {
    const cols = ['tenant_id', 'workspace_id', ...columns, ...Object.keys(extra)];
    const params = [tenantId, workspaceId, ...Object.values(spec.values), ...Object.values(extra)];
    const placeholders = params.map((_, i) => `$${i + 1}`).join(', ');
    return q.query<{ id: string }>(
      `insert into public.${table} (${cols.join(', ')}) values (${placeholders}) returning id`,
      params,
    );
  };
  const update = (q: Queryable, id: string) =>
    q.query(`update public.${table} set ${setClause} where id = $1 returning id`, [
      id,
      ...Object.values(spec.update),
    ]);
  const remove = (q: Queryable, id: string) =>
    q.query(`delete from public.${table} where id = $1 returning id`, [id]);

  describe(`isolamento de ${table}`, () => {
    let db: TestDatabase;
    let t: Tenancy;
    let rowA1: string; // criada por carol (agent) em A1
    let rowA2: string; // criada por alice (owner) em A2

    beforeAll(async () => {
      db = await createTestDatabase();
      await spec.setup?.(db);
      t = await seedTenancy(db);
      rowA1 = (await db.asUser(t.carol.id, (q) => insert(q, t.tenantA, t.a1)))[0]!.id;
      rowA2 = (await db.asUser(t.alice.id, (q) => insert(q, t.tenantA, t.a2)))[0]!.id;
    });

    afterAll(async () => {
      await spec.teardown?.(db);
      await db?.close();
    });

    it('agent cria e edita no próprio workspace', async () => {
      expect(await db.asUser(t.carol.id, (q) => update(q, rowA1))).toHaveLength(1);
    });

    if (spec.hasCreatedBy !== false) {
      it('created_by vem de auth.uid() e não pode ser forjado', async () => {
        const row = await one<{ created_by: string }>(db, `select created_by from public.${table} where id = $1`, [rowA1]);
        expect(row.created_by).toBe(t.carol.id);
        await expect(db.asUser(t.carol.id, (q) => insert(q, t.tenantA, t.a1, { created_by: t.alice.id })))
          .rejects.toThrow(/permission denied/);
      });
    }

    it('viewer lê, mas não cria nem edita', async () => {
      await db.asUser(t.vic.id, async (q) => {
        expect(await ids(q, `select id from public.${table}`)).toEqual([rowA1]);
        expect(await update(q, rowA1)).toHaveLength(0);
      });
      await expect(db.asUser(t.vic.id, (q) => insert(q, t.tenantA, t.a1))).rejects.toThrow(/row-level security/);
    });

    it('member não vê nem escreve em workspace onde não está', async () => {
      await db.asUser(t.carol.id, async (q) => {
        expect(await ids(q, `select id from public.${table}`)).toEqual([rowA1]);
        expect(await update(q, rowA2)).toHaveLength(0);
      });
      await expect(db.asUser(t.carol.id, (q) => insert(q, t.tenantA, t.a2))).rejects.toThrow(/row-level security/);
    });

    it('owner e admin veem todos os workspaces do tenant', async () => {
      const both = [rowA1, rowA2].sort();
      expect(await db.asUser(t.alice.id, (q) => ids(q, `select id from public.${table}`))).toEqual(both);
      expect(await db.asUser(t.dave.id, (q) => ids(q, `select id from public.${table}`))).toEqual(both);
    });

    it('outro tenant não lê, não altera, não apaga e não insere', async () => {
      await db.asUser(t.bob.id, async (q) => {
        expect(await q.query(`select 1 from public.${table}`)).toHaveLength(0);
        expect(await update(q, rowA1)).toHaveLength(0);
        expect(await remove(q, rowA1)).toHaveLength(0);
      });
      await expect(db.asUser(t.bob.id, (q) => insert(q, t.tenantA, t.a1))).rejects.toThrow(/row-level security/);
    });

    it('não aceita workspace de outro tenant', async () => {
      // bob é dono de B, mas aponta para o workspace A1: a FK composta barra
      await expect(db.asUser(t.bob.id, (q) => insert(q, t.tenantB, t.a1))).rejects.toThrow();
    });

    it('linha não muda de workspace nem de tenant', async () => {
      await expect(db.asUser(t.alice.id, (q) =>
        q.query(`update public.${table} set workspace_id = $1 where id = $2`, [t.a2, rowA1]),
      )).rejects.toThrow(/permission denied/);
      await expect(db.asUser(t.alice.id, (q) =>
        q.query(`update public.${table} set tenant_id = $1 where id = $2`, [t.tenantB, rowA1]),
      )).rejects.toThrow(/permission denied/);
    });

    it('agent não apaga; owner apaga', async () => {
      expect(await db.asUser(t.carol.id, (q) => remove(q, rowA1))).toHaveLength(0);
      expect(await db.asUser(t.alice.id, (q) => remove(q, rowA1))).toHaveLength(1);
    });

    it('anon não acessa', async () => {
      await expect(db.asAnon((q) => q.query(`select 1 from public.${table}`))).rejects.toThrow(/permission denied/);
    });
  });
}
