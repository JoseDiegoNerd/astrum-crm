import 'reflect-metadata';
import { ConflictException, ForbiddenException, HttpStatus, NotFoundException } from '@nestjs/common';
import type { Database, JwtClaims } from '@astrum/db';
import { createTestDatabase, seedTenancy, type Tenancy, type TestDatabase } from '@astrum/db/testing';
import { CompaniesService } from '../src/crm/companies.service.js';
import { ContactsService } from '../src/crm/contacts.service.js';
import { createCompanySchema, createContactSchema, listContactsSchema } from '../src/crm/crm.schemas.js';
import { toHttpException } from '../src/http/database-error.filter.js';
import type { WorkspaceContext } from '../src/http/request.js';

// Serviços reais + Drizzle + RLS num Postgres em memória (ou TEST_DATABASE_URL).
describe('CRM (serviços sob RLS)', () => {
  let testDb: TestDatabase;
  let db: Database;
  let t: Tenancy;
  let contactsService: ContactsService;
  let companiesService: CompaniesService;
  let a1: WorkspaceContext;
  let a2: WorkspaceContext;

  const as = (userId: string): JwtClaims => ({ sub: userId, role: 'authenticated' });
  const list = (userId: string, ws: WorkspaceContext, query: Record<string, string> = {}) =>
    contactsService.list(as(userId), ws, listContactsSchema.parse(query));
  const httpStatusOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return toHttpException(error)?.getStatus() ?? (error as { getStatus?: () => number }).getStatus?.();
    }
    throw new Error('era esperado um erro');
  };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    t = await seedTenancy(testDb);
    db = testDb.drizzle();
    contactsService = new ContactsService(db);
    companiesService = new CompaniesService(db);
    a1 = { id: t.a1, tenantId: t.tenantA };
    a2 = { id: t.a2, tenantId: t.tenantA };
  });

  afterAll(async () => {
    await testDb?.close();
  });

  describe('contatos', () => {
    let anaId: string;

    it('cria contato com identidades normalizadas e define a principal por canal', async () => {
      const input = createContactSchema.parse({
        name: 'Ana Souza',
        identities: [
          { channel: 'whatsapp', identifier: '(11) 99999-0000' },
          { channel: 'email', identifier: 'Ana@Exemplo.com' },
          { channel: 'email', identifier: 'ana.pessoal@exemplo.com' },
        ],
      });
      const ana = await contactsService.create(as(t.carol.id), a1, input);
      anaId = ana.id;

      expect(ana).toMatchObject({ name: 'Ana Souza', type: 'lead', createdBy: t.carol.id });
      // ordem do enum de canais, principal primeiro
      expect(ana.identities.map((i) => [i.channel, i.identifier, i.isPrimary])).toEqual([
        ['whatsapp', '+5511999990000', true],
        ['email', 'ana@exemplo.com', true],
        ['email', 'ana.pessoal@exemplo.com', false],
      ]);
    });

    it('recusa identidade que já é de outro contato e diz de quem', async () => {
      const input = createContactSchema.parse({
        name: 'Outra Ana',
        identities: [{ channel: 'whatsapp', identifier: '11 99999-0000' }],
      });
      const error = await contactsService.create(as(t.carol.id), a1, input).catch((e) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({ contactId: anaId });
    });

    it('busca por nome, por trecho do telefone e por e-mail', async () => {
      await contactsService.create(as(t.carol.id), a1, createContactSchema.parse({ name: 'Bruno Lima' }));
      const names = async (q: string) => (await list(t.carol.id, a1, { q })).items.map((c) => c.name);

      expect(await names('ana')).toEqual(['Ana Souza']);
      expect(await names('99999-0000')).toEqual(['Ana Souza']);
      expect(await names('pessoal@')).toEqual(['Ana Souza']);
      expect(await names('lima')).toEqual(['Bruno Lima']);
      expect(await names('100%')).toEqual([]);
    });

    it('pagina com cursor', async () => {
      const first = await list(t.carol.id, a1, { limit: '1' });
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).toBeTruthy();
      const second = await list(t.carol.id, a1, { limit: '1', cursor: first.nextCursor! });
      expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
    });

    it('arquivar tira o contato da lista padrão', async () => {
      await contactsService.setArchived(as(t.carol.id), a1, anaId, true);
      expect((await list(t.carol.id, a1)).items.map((c) => c.id)).not.toContain(anaId);
      expect((await list(t.carol.id, a1, { archived: 'true' })).items.map((c) => c.id)).toEqual([anaId]);
      await contactsService.setArchived(as(t.carol.id), a1, anaId, false);
    });

    it('troca a identidade principal do canal', async () => {
      const ana = await contactsService.get(as(t.carol.id), a1, anaId);
      const pessoal = ana.identities.find((i) => i.identifier === 'ana.pessoal@exemplo.com')!;
      const updated = await contactsService.makePrimary(as(t.carol.id), a1, anaId, pessoal.id);
      const emails = updated.identities.filter((i) => i.channel === 'email');
      expect(emails.find((i) => i.isPrimary)?.identifier).toBe('ana.pessoal@exemplo.com');
      expect(emails.filter((i) => i.isPrimary)).toHaveLength(1);
    });

    it('viewer lê mas não cria', async () => {
      expect((await list(t.vic.id, a1)).items.length).toBeGreaterThan(0);
      const status = await httpStatusOf(
        contactsService.create(as(t.vic.id), a1, createContactSchema.parse({ name: 'X' })),
      );
      expect(status).toBe(HttpStatus.FORBIDDEN);
    });

    it('quem não está no workspace não vê nem encontra o contato', async () => {
      expect((await list(t.carol.id, a2)).items).toEqual([]);
      await expect(contactsService.get(as(t.bob.id), a1, anaId)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('agent não exclui; owner exclui', async () => {
      await expect(contactsService.remove(as(t.carol.id), a1, anaId)).rejects.toBeInstanceOf(ForbiddenException);
      await contactsService.remove(as(t.alice.id), a1, anaId);
      await expect(contactsService.get(as(t.alice.id), a1, anaId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('empresas', () => {
    it('cria com CNPJ/domínio/telefone normalizados e conta os contatos', async () => {
      const company = await companiesService.create(
        as(t.carol.id),
        a1,
        createCompanySchema.parse({
          name: 'Padaria Sol',
          document: '11.222.333/0001-81',
          domain: 'https://www.PadariaSol.com.br/contato',
          phone: '(11) 3333-4444',
        }),
      );
      expect(company).toMatchObject({
        document: '11222333000181',
        domain: 'padariasol.com.br',
        phone: '+551133334444',
      });

      const contact = await contactsService.create(
        as(t.carol.id),
        a1,
        createContactSchema.parse({ name: 'Carla Sol', companyId: company.id }),
      );
      expect(contact.company).toEqual({ id: company.id, name: 'Padaria Sol' });

      const listed = await companiesService.list(as(t.carol.id), a1, { archived: false, limit: 50 });
      expect(listed.items.find((c) => c.id === company.id)?.contactCount).toBe(1);
      expect((await companiesService.get(as(t.carol.id), a1, company.id)).contacts.map((c) => c.name))
        .toEqual(['Carla Sol']);
    });

    it('recusa CNPJ com dígito verificador errado', () => {
      expect(() => createCompanySchema.parse({ name: 'X', document: '11.222.333/0001-82' })).toThrow(/CNPJ/);
    });

    it('não vincula contato a empresa de outro workspace', async () => {
      const other = await companiesService.create(as(t.alice.id), a2, createCompanySchema.parse({ name: 'Filial' }));
      const status = await httpStatusOf(
        contactsService.create(as(t.alice.id), a1, createContactSchema.parse({ name: 'Y', companyId: other.id })),
      );
      expect(status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    });
  });
});
