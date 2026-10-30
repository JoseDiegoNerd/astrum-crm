import 'reflect-metadata';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { JwtClaims } from '@astrum/db';
import { createTestDatabase, seedTenancy, type Tenancy, type TestDatabase } from '@astrum/db/testing';
import { ContactsService } from '../src/crm/contacts.service.js';
import { createContactSchema, createFieldSchema, importContactsSchema, listContactsSchema } from '../src/crm/crm.schemas.js';
import { ImportService } from '../src/crm/import.service.js';
import { SettingsService } from '../src/crm/settings.service.js';
import type { WorkspaceContext } from '../src/http/request.js';

describe('CRM · importação de contatos por CSV (serviços sob RLS)', () => {
  let testDb: TestDatabase;
  let t: Tenancy;
  let importer: ImportService;
  let contactsService: ContactsService;
  let settings: SettingsService;
  let a1: WorkspaceContext;
  let a2: WorkspaceContext;

  const as = (userId: string): JwtClaims => ({ sub: userId, role: 'authenticated' });
  const run = (csv: string, mode: 'skip' | 'merge' = 'skip', ws = a1, userId = t.carol.id) =>
    importer.importContacts(as(userId), ws, importContactsSchema.parse({ csv, mode }));
  const findByName = async (name: string, ws = a1) =>
    (await contactsService.list(as(t.alice.id), ws, listContactsSchema.parse({ q: name }))).items.find((c) => c.name === name);

  beforeAll(async () => {
    testDb = await createTestDatabase();
    t = await seedTenancy(testDb);
    const db = testDb.drizzle();
    importer = new ImportService(db);
    contactsService = new ContactsService(db);
    settings = new SettingsService(db);
    a1 = { id: t.a1, tenantId: t.tenantA };
    a2 = { id: t.a2, tenantId: t.tenantA };
    await settings.createTag(as(t.mia.id), a1, { name: 'VIP' });
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it('importa CSV do Excel brasileiro: normaliza canais, cria empresa uma vez, aplica tags', async () => {
    const csv = [
      'Nome;Celular;E-mail;Empresa;Tipo;Tags;Observação',
      'Ana Souza;(11) 99999-0001;ANA@exemplo.com;Padaria Sol;Cliente;VIP|Inexistente;cliente antiga',
      'Bruno Lima;11 99999-0002;;padaria sol;;;',
      'Carla;;carla@exemplo.com;;Lead;;',
    ].join('\r\n');
    const report = await run(csv);

    expect(report).toMatchObject({ total: 3, created: 3, updated: 0, skipped: 0, errors: [] });
    expect(report.columns).toMatchObject({ name: 'Nome', whatsapp: 'Celular', email: 'E-mail', company: 'Empresa' });
    expect(report.ignoredColumns).toEqual(['Observação']);
    expect(report.warnings.join()).toContain('Inexistente');

    const ana = await findByName('Ana Souza');
    expect(ana).toMatchObject({ type: 'customer', companyName: 'Padaria Sol' });
    expect(ana!.identities.map((i) => [i.channel, i.identifier])).toEqual([
      ['whatsapp', '+5511999990001'],
      ['email', 'ana@exemplo.com'],
    ]);
    expect(ana!.tags.map((tag) => tag.name)).toEqual(['VIP']);
    // "padaria sol" reaproveitou a empresa criada na linha anterior
    expect((await findByName('Bruno Lima'))!.companyId).toBe(ana!.companyId);
  });

  it('pula quem já existe (pelo canal) e duplicados dentro do próprio arquivo', async () => {
    const csv = [
      'nome,whatsapp,email',
      'Ana de novo,+55 11 99999-0001,',
      'Daniel,11 98888-0000,',
      'Daniel repetido,(11) 98888-0000,',
    ].join('\n');
    const report = await run(csv);
    expect(report).toMatchObject({ created: 1, skipped: 2, errors: [] });
    expect(await findByName('Ana de novo')).toBeUndefined();
  });

  it('modo mesclar completa o contato existente sem roubar canais de outro', async () => {
    const csv = 'nome;whatsapp;email;empresa\nAna (planilha nova);11 99999-0001;ana.pessoal@exemplo.com;Outra Empresa';
    const report = await run(csv, 'merge');
    expect(report).toMatchObject({ created: 0, updated: 1 });
    const ana = await findByName('Ana Souza');
    expect(ana!.identities.map((i) => i.identifier)).toContain('ana.pessoal@exemplo.com');
    // já tinha empresa: não troca
    expect(ana!.companyName).toBe('Padaria Sol');
  });

  it('erros ficam na linha deles; as outras linhas entram', async () => {
    const csv = [
      'Nome;Telefone;Tipo',
      ';11 3333-4444;',
      'Erika;123;',
      'Fábio;;Fornecedor',
      'Gabi;11 3333-5555;Lead',
    ].join('\n');
    const report = await run(csv);
    expect(report.created).toBe(1);
    expect(report.errors).toEqual([
      { line: 2, message: 'Nome vazio' },
      { line: 3, message: expect.stringContaining('Telefone inválido') },
      { line: 4, message: expect.stringContaining('Tipo desconhecido') },
    ]);
  });

  it('exige a coluna Nome e respeita o limite de linhas', async () => {
    await expect(run('email\na@b.com')).rejects.toBeInstanceOf(BadRequestException);
    const tooBig = ['nome', ...Array.from({ length: 5001 }, (_, i) => `Pessoa ${i}`)].join('\n');
    await expect(run(tooBig)).rejects.toThrow(/Máximo de 5000/);
  });

  it('campo customizado obrigatório vira erro da linha', async () => {
    await settings.createField(
      as(t.alice.id),
      a2,
      createFieldSchema.parse({ entity: 'contact', label: 'Origem', type: 'text', required: true }),
    );
    const report = await run('nome\nHelena', 'skip', a2, t.alice.id);
    expect(report.created).toBe(0);
    expect(report.errors[0]!.message).toContain('Origem é obrigatório');
  });

  it('viewer não importa', async () => {
    const report = await run('nome\nIvo', 'skip', a1, t.vic.id).catch((e) => e);
    // cada linha falha pela RLS (sem permissão), nada é criado
    expect(report instanceof ForbiddenException || report.created === 0).toBe(true);
    expect(await findByName('Ivo')).toBeUndefined();
  });

  it('importa 1.000 linhas de uma vez', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => `Lote ${i};11 97${String(i).padStart(7, '0')}`);
    const started = performance.now();
    const report = await run(['nome;celular', ...rows].join('\n'));
    console.info(`importação de 1000 linhas: ${(performance.now() - started).toFixed(0)} ms`);
    expect(report).toMatchObject({ created: 1000, errors: [] });
  }, 120_000);

  it('a importação gera contatos normais (aparecem na busca e não duplicam pela API)', async () => {
    const error = await contactsService
      .create(as(t.carol.id), a1, createContactSchema.parse({ name: 'X', identities: [{ channel: 'whatsapp', identifier: '11 99999-0002' }] }))
      .catch((e) => e);
    expect(error.getResponse?.()).toMatchObject({ message: expect.stringContaining('Bruno Lima') });
  });
});
