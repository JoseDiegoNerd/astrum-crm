import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { one, seedTenancy, type Tenancy } from '../src/testing/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../src/testing/harness.js';
import { describeWorkspaceTable, type WorkspaceRef } from './workspace-table-suite.js';

// Cria um contato no workspace como superusuário (pré-requisito das identidades).
// O tenant vem do próprio workspace, para que o contato seja sempre válido.
let seq = 0;
async function contactIn(ws: WorkspaceRef, db: TestDatabase) {
  const row = await one<{ id: string }>(
    db,
    `insert into contacts (tenant_id, workspace_id, name)
     select tenant_id, id, 'Contato de apoio' from workspaces where id = $1
     returning id`,
    [ws.workspaceId],
  );
  return { contact_id: row.id, channel: 'email', identifier: `apoio${++seq}@exemplo.com` };
}

describeWorkspaceTable({
  table: 'companies',
  values: { name: 'Padaria Sol' },
  update: { name: 'Padaria Sol Ltda' },
});

describeWorkspaceTable({
  table: 'contacts',
  values: { name: 'Ana Souza' },
  update: { name: 'Ana S.' },
});

describeWorkspaceTable({
  table: 'contact_identities',
  values: contactIn,
  update: { is_primary: true },
  agentCanDelete: true,
});

describe('regras de contatos e identidades', () => {
  let db: TestDatabase;
  let t: Tenancy;
  let contactA1: string;

  const asCarol = <T>(sql: string, params?: unknown[]) =>
    db.asUser(t.carol.id, (q) => q.query<T>(sql, params));

  beforeAll(async () => {
    db = await createTestDatabase();
    t = await seedTenancy(db);
    contactA1 = (
      await asCarol<{ id: string }>(
        `insert into contacts (tenant_id, workspace_id, name) values ($1, $2, 'Bruno') returning id`,
        [t.tenantA, t.a1],
      )
    )[0]!.id;
    await asCarol(
      `insert into contact_identities (tenant_id, workspace_id, contact_id, channel, identifier, is_primary)
       values ($1, $2, $3, 'whatsapp', '+5511999990000', true)`,
      [t.tenantA, t.a1, contactA1],
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  const identity = (workspaceId: string, contactId: string, channel: string, identifier: string, isPrimary = false) =>
    db.asUser(t.alice.id, (q) =>
      q.query(
        `insert into contact_identities (tenant_id, workspace_id, contact_id, channel, identifier, is_primary)
         values ($1, $2, $3, $4, $5, $6)`,
        [t.tenantA, workspaceId, contactId, channel, identifier, isPrimary],
      ));

  it('recusa a mesma identidade duas vezes no workspace', async () => {
    const other = (await asCarol<{ id: string }>(
      `insert into contacts (tenant_id, workspace_id, name) values ($1, $2, 'Duplicado') returning id`,
      [t.tenantA, t.a1],
    ))[0]!.id;
    await expect(identity(t.a1, other, 'whatsapp', '+5511999990000'))
      .rejects.toThrow(/contact_identities_workspace_id_channel_identifier_key/);
  });

  it('aceita a mesma identidade em outro workspace (dados independentes)', async () => {
    const inA2 = (await db.asUser(t.alice.id, (q) => q.query<{ id: string }>(
      `insert into contacts (tenant_id, workspace_id, name) values ($1, $2, 'Bruno filial') returning id`,
      [t.tenantA, t.a2],
    )))[0]!.id;
    await expect(identity(t.a2, inA2, 'whatsapp', '+5511999990000')).resolves.toBeDefined();
  });

  it('não liga identidade a contato de outro workspace', async () => {
    await expect(identity(t.a2, contactA1, 'email', 'bruno@exemplo.com')).rejects.toThrow(/foreign key/);
  });

  it.each([
    ['phone', '11999990000'],
    ['whatsapp', '+55 11 99999-0000'],
    ['email', 'Bruno@Exemplo.com'],
    ['email', 'sem-arroba'],
    ['instagram', '@bruno'],
  ])('recusa %s fora do formato normalizado: %s', async (channel, identifier) => {
    await expect(identity(t.a1, contactA1, channel, identifier)).rejects.toThrow(/identifier_format/);
  });

  it('permite só uma identidade principal por canal no contato', async () => {
    await expect(identity(t.a1, contactA1, 'whatsapp', '+5511988887777', true))
      .rejects.toThrow(/one_primary/);
  });

  it('usuário não marca identidade como verificada', async () => {
    await expect(asCarol(`update contact_identities set verified = true where contact_id = $1`, [contactA1]))
      .rejects.toThrow(/permission denied/);
  });

  it('identificador é imutável', async () => {
    await expect(asCarol(`update contact_identities set identifier = '+5511000000000' where contact_id = $1`, [contactA1]))
      .rejects.toThrow(/permission denied/);
  });

  it('não liga contato a empresa de outro workspace', async () => {
    const companyA2 = (await db.asUser(t.alice.id, (q) => q.query<{ id: string }>(
      `insert into companies (tenant_id, workspace_id, name) values ($1, $2, 'Empresa da filial') returning id`,
      [t.tenantA, t.a2],
    )))[0]!.id;
    await expect(asCarol(`update contacts set company_id = $1 where id = $2`, [companyA2, contactA1]))
      .rejects.toThrow(/foreign key/);
  });

  it('responsável precisa ser membro do tenant', async () => {
    await expect(asCarol(`update contacts set owner_id = $1 where id = $2`, [t.bob.id, contactA1]))
      .rejects.toThrow(/foreign key/);
    expect(await asCarol(`update contacts set owner_id = $1 where id = $2 returning id`, [t.carol.id, contactA1]))
      .toHaveLength(1);
  });

  it('agent arquiva contato', async () => {
    expect(await asCarol(`update contacts set archived_at = now() where id = $1 returning id`, [contactA1]))
      .toHaveLength(1);
    await asCarol(`update contacts set archived_at = null where id = $1`, [contactA1]);
  });

  it('CNPJ é único por workspace', async () => {
    await asCarol(`insert into companies (tenant_id, workspace_id, name, document) values ($1, $2, 'X', '12345678000190')`,
      [t.tenantA, t.a1]);
    await expect(asCarol(
      `insert into companies (tenant_id, workspace_id, name, document) values ($1, $2, 'Y', '12345678000190')`,
      [t.tenantA, t.a1],
    )).rejects.toThrow(/companies_workspace_document_key/);
  });

  it('apagar empresa desvincula os contatos; apagar contato remove identidades', async () => {
    const company = (await asCarol<{ id: string }>(
      `insert into companies (tenant_id, workspace_id, name) values ($1, $2, 'Temporária') returning id`,
      [t.tenantA, t.a1],
    ))[0]!.id;
    await asCarol(`update contacts set company_id = $1 where id = $2`, [company, contactA1]);
    await db.asUser(t.alice.id, (q) => q.query(`delete from companies where id = $1`, [company]));
    const contact = await one<{ company_id: string | null }>(db, `select company_id from contacts where id = $1`, [contactA1]);
    expect(contact.company_id).toBeNull();

    await db.asUser(t.alice.id, (q) => q.query(`delete from contacts where id = $1`, [contactA1]));
    expect(await db.query(`select 1 from contact_identities where contact_id = $1`, [contactA1])).toHaveLength(0);
  });
});
