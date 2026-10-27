import { getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

/**
 * INSERT que lista só as colunas informadas.
 *
 * O `db.insert()` do Drizzle escreve todas as colunas da tabela (as omitidas
 * como `default`), e o Postgres exige privilégio de INSERT em cada coluna
 * listada. Como as tabelas de negócio só concedem INSERT nas colunas editáveis
 * (created_by, verified etc. ficam de fora), use este helper para elas:
 *
 *   const [row] = await insertRows(tx, contacts, { tenantId, workspaceId, name });
 */
export function insertSql<T extends PgTable>(table: T, values: Partial<T['$inferInsert']>): SQL {
  const columns = getTableColumns(table);
  const entries = Object.entries(values).filter(([, value]) => value !== undefined);
  if (entries.length === 0) throw new Error('insertSql: nenhum valor informado');

  const names = entries.map(([key]) => sql.identifier(column(columns, key).name));
  const params = entries.map(([key, value]) => sql.param(value, column(columns, key)));
  return sql`insert into ${table} (${sql.join(names, sql`, `)}) values (${sql.join(params, sql`, `)}) returning *`;
}

interface Executor {
  execute(query: SQL): PromiseLike<unknown>;
}

/**
 * Executa SQL cru e devolve as linhas. O postgres.js (produção) devolve um
 * array; o PGlite (testes) devolve `{ rows }` — aqui os dois viram array.
 */
export async function executeRows<T = Record<string, unknown>>(tx: Executor, query: SQL): Promise<T[]> {
  const result = await tx.execute(query);
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result && Array.isArray(result.rows)) {
    return result.rows as T[];
  }
  throw new Error('executeRows: formato de resultado inesperado');
}

/** Executa insertSql e devolve as linhas no formato do Drizzle (camelCase, tipos mapeados). */
export async function insertRows<T extends PgTable>(
  tx: Executor,
  table: T,
  values: Partial<T['$inferInsert']>,
): Promise<T['$inferSelect'][]> {
  const rows = await executeRows(tx, insertSql(table, values));
  return rows.map((row) => mapRow(table, row));
}

export function mapRow<T extends PgTable>(table: T, row: Record<string, unknown>): T['$inferSelect'] {
  const mapped: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(getTableColumns(table))) {
    const raw = row[col.name];
    mapped[key] = raw === null || raw === undefined ? raw ?? null : col.mapFromDriverValue(raw);
  }
  return mapped as T['$inferSelect'];
}

function column(columns: ReturnType<typeof getTableColumns>, key: string) {
  const col = columns[key];
  if (!col) throw new Error(`insertSql: coluna desconhecida "${key}"`);
  return col;
}
