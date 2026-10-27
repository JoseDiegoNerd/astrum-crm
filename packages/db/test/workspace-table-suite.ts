import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ids, one, seedTenancy, type Tenancy } from '../src/testing/fixtures.js';
import { createTestDatabase, type Queryable, type TestDatabase } from '../src/testing/harness.js';

export interface WorkspaceTableSpec {
  /** Nome da tabela em public. */
  table: string;
  /**
   * Colunas de negócio válidas para um INSERT (sem tenant_id/workspace_id).
   * Use função quando o valor depende do workspace (ex.: contact_id de um
   * contato criado ali); ela roda como superusuário antes de cada insert.
   */
  values: Record<string, unknown> | ((ws: WorkspaceRef, db: TestDatabase) => Promise<Record<string, unknown>>);
  /** Alteração válida de uma coluna editável. Omita em tabelas sem UPDATE (ex.: junções). */
  update?: Record<string, unknown>;
  /**
   * Quem escreve: 'agent' (padrão — dados do dia a dia) ou 'manager'
   * (configuração do workspace, ex.: tags e campos customizados).
   */
  writers?: 'agent' | 'manager';
  /** Roda antes do seed (ex.: criar a tabela num teste de template). */
  setup?: (db: TestDatabase) => Promise<void>;
  teardown?: (db: TestDatabase) => Promise<void>;
  /** A tabela tem created_by preenchido por auth.uid()? (padrão: true) */
  hasCreatedBy?: boolean;
  /** Agent também pode apagar? (padrão: false — só manager) */
  agentCanDelete?: boolean;
}

export interface WorkspaceRef {
  tenantId: string;
  workspaceId: string;
}

/**
 * Suíte de isolamento obrigatória para toda tabela de negócio de workspace.
 * Verifica o padrão do template packages/db/templates/workspace-table.sql:
 * viewer lê · agent cria/edita · manager (e owner/admin) apaga · ninguém de fora vê nada.
 * Com writers: 'manager', só manager cria/edita (configuração do workspace).
 *
 *   describeWorkspaceTable({ table: 'contacts', values: { name: 'Ana' }, update: { name: 'Ana B.' } });
 */
export function describeWorkspaceTable(spec: WorkspaceTableSpec) {
  const { table } = spec;
  const updates = spec.update;
  const managerOnly = spec.writers === 'manager';
  const setClause = updates ? Object.keys(updates).map((c, i) => `${c} = $${i + 2}`).join(', ') : '';

  let db: TestDatabase;
  const valuesFor = (tenantId: string, workspaceId: string) =>
    typeof spec.values === 'function' ? spec.values({ tenantId, workspaceId }, db) : Promise.resolve(spec.values);

  // Os valores são resolvidos antes de abrir a transação do usuário: a função de
  // values roda como superusuário e o banco de teste tem uma conexão só.
  const insertAs = async (
    userId: string,
    tenantId: string,
    workspaceId: string,
    extra: Record<string, unknown> = {},
  ) => {
    const values = { ...(await valuesFor(tenantId, workspaceId)), ...extra };
    const cols = ['tenant_id', 'workspace_id', ...Object.keys(values)];
    const params = [tenantId, workspaceId, ...Object.values(values)];
    const placeholders = params.map((_, i) => `$${i + 1}`).join(', ');
    return db.asUser(userId, (q) =>
      q.query<{ id: string }>(
        `insert into public.${table} (${cols.join(', ')}) values (${placeholders}) returning id`,
        params,
      ),
    );
  };
  const update = (q: Queryable, id: string) =>
    q.query(`update public.${table} set ${setClause} where id = $1 returning id`, [
      id,
      ...Object.values(updates ?? {}),
    ]);
  const remove = (q: Queryable, id: string) =>
    q.query(`delete from public.${table} where id = $1 returning id`, [id]);
  // Olha só as linhas criadas pelo teste: algumas tabelas já nascem com dados
  // em todo workspace (ex.: pipeline padrão), que não interessam aqui.
  const visible = (q: Queryable, rows: string[]) =>
    ids(q, `select id from public.${table} where id = any($1::uuid[])`, [rows]);

  describe(`isolamento de ${table}`, () => {
    let t: Tenancy;
    let rowA1: string; // criada em A1 por carol (agent) ou mia (manager do workspace)
    let rowA2: string; // criada por alice (owner) em A2
    let creatorA1: string;

    beforeAll(async () => {
      db = await createTestDatabase();
      await spec.setup?.(db);
      t = await seedTenancy(db);
      creatorA1 = managerOnly ? t.mia.id : t.carol.id;
      rowA1 = (await insertAs(creatorA1, t.tenantA, t.a1))[0]!.id;
      rowA2 = (await insertAs(t.alice.id, t.tenantA, t.a2))[0]!.id;
    });

    afterAll(async () => {
      await spec.teardown?.(db);
      await db?.close();
    });

    if (managerOnly) {
      it('agent não cria nem edita; manager do workspace edita', async () => {
        await expect(insertAs(t.carol.id, t.tenantA, t.a1)).rejects.toThrow(/row-level security/);
        if (updates) {
          expect(await db.asUser(t.carol.id, (q) => update(q, rowA1))).toHaveLength(0);
          expect(await db.asUser(t.mia.id, (q) => update(q, rowA1))).toHaveLength(1);
        }
      });
    } else if (updates) {
      it('agent cria e edita no próprio workspace', async () => {
        expect(await db.asUser(t.carol.id, (q) => update(q, rowA1))).toHaveLength(1);
      });
    }

    if (spec.hasCreatedBy !== false) {
      it('created_by vem de auth.uid() e não pode ser forjado', async () => {
        const row = await one<{ created_by: string }>(db, `select created_by from public.${table} where id = $1`, [rowA1]);
        expect(row.created_by).toBe(creatorA1);
        await expect(insertAs(creatorA1, t.tenantA, t.a1, { created_by: t.alice.id }))
          .rejects.toThrow(/permission denied/);
      });
    }

    it('viewer lê, mas não cria nem edita', async () => {
      await db.asUser(t.vic.id, async (q) => {
        expect(await visible(q, [rowA1, rowA2])).toEqual([rowA1]);
        if (updates) expect(await update(q, rowA1)).toHaveLength(0);
      });
      await expect(insertAs(t.vic.id, t.tenantA, t.a1)).rejects.toThrow(/row-level security/);
    });

    it('member não vê nem escreve em workspace onde não está', async () => {
      await db.asUser(t.carol.id, async (q) => {
        expect(await visible(q, [rowA1, rowA2])).toEqual([rowA1]);
        if (updates) expect(await update(q, rowA2)).toHaveLength(0);
      });
      await expect(insertAs(t.carol.id, t.tenantA, t.a2)).rejects.toThrow(/row-level security/);
    });

    it('owner e admin veem todos os workspaces do tenant', async () => {
      const both = [rowA1, rowA2].sort();
      expect(await db.asUser(t.alice.id, (q) => visible(q, both))).toEqual(both);
      expect(await db.asUser(t.dave.id, (q) => visible(q, both))).toEqual(both);
    });

    it('outro tenant não lê, não altera, não apaga e não insere', async () => {
      await db.asUser(t.bob.id, async (q) => {
        expect(await visible(q, [rowA1, rowA2])).toHaveLength(0);
        if (updates) expect(await update(q, rowA1)).toHaveLength(0);
        expect(await remove(q, rowA1)).toHaveLength(0);
      });
      await expect(insertAs(t.bob.id, t.tenantA, t.a1)).rejects.toThrow(/row-level security/);
    });

    it('não aceita workspace de outro tenant', async () => {
      // bob é dono de B, mas aponta para o workspace A1: a FK composta barra
      await expect(insertAs(t.bob.id, t.tenantB, t.a1)).rejects.toThrow();
    });

    it('linha não muda de workspace nem de tenant', async () => {
      await expect(db.asUser(t.alice.id, (q) =>
        q.query(`update public.${table} set workspace_id = $1 where id = $2`, [t.a2, rowA1]),
      )).rejects.toThrow(/permission denied/);
      await expect(db.asUser(t.alice.id, (q) =>
        q.query(`update public.${table} set tenant_id = $1 where id = $2`, [t.tenantB, rowA1]),
      )).rejects.toThrow(/permission denied/);
    });

    if (spec.agentCanDelete) {
      it('viewer não apaga; agent apaga', async () => {
        expect(await db.asUser(t.vic.id, (q) => remove(q, rowA1))).toHaveLength(0);
        expect(await db.asUser(t.carol.id, (q) => remove(q, rowA1))).toHaveLength(1);
      });
    } else {
      it('agent não apaga; manager do workspace e owner apagam', async () => {
        expect(await db.asUser(t.carol.id, (q) => remove(q, rowA1))).toHaveLength(0);
        expect(await db.asUser(t.mia.id, (q) => remove(q, rowA1))).toHaveLength(1);
        expect(await db.asUser(t.alice.id, (q) => remove(q, rowA2))).toHaveLength(1);
      });
    }

    it('anon não acessa', async () => {
      await expect(db.asAnon((q) => q.query(`select 1 from public.${table}`))).rejects.toThrow(/permission denied/);
    });
  });
}
