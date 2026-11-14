import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Claims do JWT do Supabase já validado pela API. */
export interface JwtClaims {
  sub: string;
  role?: string;
  email?: string;
  [claim: string]: unknown;
}

export function createDatabase(url: string): { db: Database; close: () => Promise<void> } {
  // prepare: false — exigido pelo pooler do Supabase em modo transação.
  const client = postgres(url, { prepare: false, max: 10 });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

/**
 * Executa `fn` numa transação com o papel `authenticated` e as claims do usuário,
 * do mesmo jeito que a Data API do Supabase faz — assim auth.uid() e todas as
 * políticas RLS valem também para a API. Nunca consulte dados de tenant fora daqui.
 */
export function withUserContext<T>(
  db: Database,
  claims: JwtClaims,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true),
                 set_config('role', 'authenticated', true)`,
    );
    return fn(tx);
  });
}

/**
 * Transação SEM usuário, para webhooks e workers: a conexão da API é dona das
 * tabelas e ignora a RLS. Use só em código que não atende requisição de usuário
 * e filtre SEMPRE por workspace_id/tenant_id vindos do próprio registro (ex.: o
 * canal do webhook), nunca do payload externo. auth.uid() fica nulo (created_by
 * e actor_id ficam vazios = "sistema").
 */
export function withServiceContext<T>(db: Database, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
    return fn(tx);
  });
}
