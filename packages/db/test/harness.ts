import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '../../../supabase/migrations');

export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export interface TestDatabase extends Queryable {
  /** Executa `fn` como o usuário (papel authenticated + claims), como a API faz. */
  asUser<T>(userId: string, fn: (db: Queryable) => Promise<T>): Promise<T>;
  /** Executa `fn` com o papel anon (sem login). */
  asAnon<T>(fn: (db: Queryable) => Promise<T>): Promise<T>;
  createUser(email: string, name?: string): Promise<TestUser>;
  close(): Promise<void>;
}

export interface TestUser {
  id: string;
  email: string;
}

const roleSql = `select set_config('request.jwt.claims', $1, true), set_config('role', $2, true)`;

/**
 * Banco de teste. Com TEST_DATABASE_URL usa o Postgres real do Supabase local
 * (migrations já aplicadas por `supabase start`); sem ela, sobe um PGlite em
 * memória com um stub do Supabase e aplica as migrations do repositório.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const url = process.env.TEST_DATABASE_URL;
  return url ? connectPostgres(url) : startPglite();
}

async function startPglite(): Promise<TestDatabase> {
  const pg = new PGlite();
  await pg.exec(await readFile(join(here, 'supabase-stub.sql'), 'utf8'));
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    await pg.exec(await readFile(join(migrationsDir, file), 'utf8'));
  }

  const wrap = (q: Pick<PGlite, 'query'>): Queryable => ({
    async query<T>(text: string, params?: unknown[]) {
      return (await q.query<T>(text, params)).rows;
    },
  });
  const as = <T>(role: string, claims: object, fn: (db: Queryable) => Promise<T>) =>
    pg.transaction(async (tx) => {
      await tx.query(roleSql, [JSON.stringify(claims), role]);
      return fn(wrap(tx));
    });

  return {
    ...wrap(pg),
    asUser: (userId, fn) => as('authenticated', { sub: userId, role: 'authenticated' }, fn),
    asAnon: (fn) => as('anon', { role: 'anon' }, fn),
    createUser: (email, name) => insertUser(wrap(pg), email, name),
    close: () => pg.close(),
  };
}

async function connectPostgres(url: string): Promise<TestDatabase> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });

  const wrap = (q: postgres.Sql | postgres.TransactionSql): Queryable => ({
    async query<T>(text: string, params: unknown[] = []) {
      return (await q.unsafe(text, params as postgres.ParameterOrJSON<never>[])) as unknown as T[];
    },
  });
  const as = <T>(role: string, claims: object, fn: (db: Queryable) => Promise<T>) =>
    sql.begin(async (tx) => {
      await tx.unsafe(roleSql, [JSON.stringify(claims), role]);
      return fn(wrap(tx));
    }) as Promise<T>;

  return {
    ...wrap(sql),
    asUser: (userId, fn) => as('authenticated', { sub: userId, role: 'authenticated' }, fn),
    asAnon: (fn) => as('anon', { role: 'anon' }, fn),
    createUser: (email, name) => insertUser(wrap(sql), email, name),
    close: () => sql.end(),
  };
}

async function insertUser(db: Queryable, email: string, name?: string): Promise<TestUser> {
  // e-mail único por execução: no Postgres real os dados persistem entre rodadas
  const unique = email.replace('@', `+${crypto.randomUUID().slice(0, 8)}@`);
  const [row] = await db.query<{ id: string }>(
    `insert into auth.users (id, email, raw_user_meta_data)
     values (gen_random_uuid(), $1, jsonb_build_object('name', $2::text))
     returning id`,
    [unique, name ?? email],
  );
  return { id: row!.id, email: unique };
}
