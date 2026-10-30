import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertInWorkspace, seedTenancy, type Tenancy } from '../src/testing/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../src/testing/harness.js';

// Critério da F1.6: busca por trecho de nome/telefone rápida com 50 mil contatos.
const CONTACTS = 50_000;

// Mesma forma da consulta de ContactsService.list com ?q=: a função privada
// acha os ids usando os índices e a consulta externa continua sob RLS.
const SEARCH = `
  select c.id, c.name from contacts c
  where c.workspace_id = $1 and c.archived_at is null
    and c.id in (select private.search_contact_ids($1, $2, $3))
  order by c.created_at desc, c.id desc
  limit 51`;

describe('busca de contatos com volume (pg_trgm)', () => {
  let db: TestDatabase;
  let t: Tenancy;

  const search = (userId: string, workspaceId: string, term: string, identifierTerm = term) =>
    db.asUser(userId, (q) => q.query<{ id: string; name: string }>(SEARCH, [workspaceId, term, identifierTerm]));

  beforeAll(async () => {
    db = await createTestDatabase();
    t = await seedTenancy(db);
    // 50 mil contatos com WhatsApp único, inseridos direto pelo superusuário
    await db.exec(`
      insert into contacts (tenant_id, workspace_id, name)
      select '${t.tenantA}', '${t.a1}', 'Cliente ' || g || ' ' || md5(g::text)
      from generate_series(1, ${CONTACTS}) g;
      insert into contact_identities (tenant_id, workspace_id, contact_id, channel, identifier, is_primary)
      select tenant_id, workspace_id, id, 'whatsapp',
             '+55119' || lpad((row_number() over (order by name))::text, 8, '0'), true
      from contacts where workspace_id = '${t.a1}';
      analyze contacts; analyze contact_identities;
    `);
  }, 180_000);

  afterAll(async () => {
    await db?.close();
  });

  it('a consulta da função usa os índices de trigramas', async () => {
    // sem RLS (como dentro da função SECURITY DEFINER)
    const plan = async (sql: string, params: unknown[]) =>
      (await db.query<{ 'QUERY PLAN': string }>(`explain ${sql}`, params)).map((r) => r['QUERY PLAN']).join('\n');
    expect(await plan(`select id from contacts where workspace_id = $1 and name ilike $2`, [t.a1, '%cliente 4242 %']))
      .toContain('contacts_name_trgm_idx');
    expect(
      await plan(`select contact_id from contact_identities where workspace_id = $1 and identifier ilike $2`, [t.a1, '%99000424%']),
    ).toContain('contact_identities_identifier_trgm_idx');
  });

  it('encontra por trecho de nome e de telefone, dentro do orçamento', async () => {
    const timed = async (term: string) => {
      const started = performance.now();
      const rows = await search(t.carol.id, t.a1, term);
      return { rows, ms: performance.now() - started };
    };

    const byName = await timed('Cliente 31337 ');
    expect(byName.rows.map((r) => r.name.split(' ').slice(0, 2).join(' '))).toEqual(['Cliente 31337']);
    const byPhone = await timed('00031337');
    expect(byPhone.rows).toHaveLength(1);

    // Produção (Postgres nativo): alvo < 300 ms. O PGlite (WebAssembly) é mais
    // lento; o limite aqui pega a regressão para varredura completa (~5 s medidos).
    console.info(`busca em ${CONTACTS} contatos: nome ${byName.ms.toFixed(0)} ms, telefone ${byPhone.ms.toFixed(0)} ms`);
    expect(byName.ms).toBeLessThan(1500);
    expect(byPhone.ms).toBeLessThan(1500);
  });

  it('trata curingas do termo como texto', async () => {
    await insertInWorkspace(db, t.a1, 'contacts', { name: '100% Natural' });
    expect((await search(t.carol.id, t.a1, '100%')).map((r) => r.name)).toEqual(['100% Natural']);
    expect(await search(t.carol.id, t.a1, '_00%')).toEqual([]);
  });

  it('não devolve nada de workspace sem acesso, mesmo chamando a função direto', async () => {
    await insertInWorkspace(db, t.a2, 'contacts', { name: 'Cliente da filial' });
    const direct = (userId: string, workspaceId: string) =>
      db.asUser(userId, (q) =>
        q.query(`select * from private.search_contact_ids($1, 'Cliente', 'Cliente')`, [workspaceId]),
      );
    expect(await direct(t.carol.id, t.a2)).toEqual([]); // carol não está em A2
    expect(await direct(t.bob.id, t.a1)).toEqual([]); // outro tenant
    expect((await direct(t.alice.id, t.a2)).length).toBe(1); // owner vê
    await expect(
      db.asAnon((q) => q.query(`select * from private.search_contact_ids($1, 'x', 'x')`, [t.a1])),
    ).rejects.toThrow(/permission denied/);
  });
});
