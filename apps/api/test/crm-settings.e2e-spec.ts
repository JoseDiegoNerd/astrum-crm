import 'reflect-metadata';
import { BadRequestException, ForbiddenException, HttpStatus } from '@nestjs/common';
import type { JwtClaims } from '@astrum/db';
import { createTestDatabase, seedTenancy, type Tenancy, type TestDatabase } from '@astrum/db/testing';
import { CompaniesService } from '../src/crm/companies.service.js';
import { ContactsService } from '../src/crm/contacts.service.js';
import {
  createCompanySchema,
  createContactSchema,
  createFieldSchema,
  listContactsSchema,
  updateContactSchema,
} from '../src/crm/crm.schemas.js';
import { SettingsService } from '../src/crm/settings.service.js';
import { toHttpException } from '../src/http/database-error.filter.js';
import type { WorkspaceContext } from '../src/http/request.js';

// Tags e campos customizados: serviços reais + Drizzle + RLS.
describe('CRM · tags e campos customizados (serviços sob RLS)', () => {
  let testDb: TestDatabase;
  let t: Tenancy;
  let settings: SettingsService;
  let contactsService: ContactsService;
  let companiesService: CompaniesService;
  let a1: WorkspaceContext;
  let a2: WorkspaceContext;

  const as = (userId: string): JwtClaims => ({ sub: userId, role: 'authenticated' });
  const statusOf = async (promise: Promise<unknown>) => {
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
    const db = testDb.drizzle();
    settings = new SettingsService(db);
    contactsService = new ContactsService(db);
    companiesService = new CompaniesService(db);
    a1 = { id: t.a1, tenantId: t.tenantA };
    a2 = { id: t.a2, tenantId: t.tenantA };
  });

  afterAll(async () => {
    await testDb?.close();
  });

  describe('tags', () => {
    let vip: string;
    let quente: string;
    let anaId: string;

    beforeAll(async () => {
      vip = (await settings.createTag(as(t.mia.id), a1, { name: 'VIP', color: '#f59e0b' })).id;
      quente = (await settings.createTag(as(t.mia.id), a1, { name: 'Lead quente' })).id;
      anaId = (await contactsService.create(as(t.carol.id), a1, createContactSchema.parse({ name: 'Ana' }))).id;
    });

    it('só manager cria tag', async () => {
      expect(await statusOf(settings.createTag(as(t.carol.id), a1, { name: 'Agent' }))).toBe(HttpStatus.FORBIDDEN);
      expect(await statusOf(settings.createTag(as(t.mia.id), a1, { name: 'vip' }))).toBe(HttpStatus.CONFLICT);
    });

    it('agent aplica, troca e filtra por tag', async () => {
      const tagged = await contactsService.setTags(as(t.carol.id), a1, anaId, { tagIds: [vip, quente] });
      expect(tagged.tags.map((tag) => tag.name)).toEqual(['Lead quente', 'VIP']);

      const list = (tag: string) =>
        contactsService.list(as(t.carol.id), a1, listContactsSchema.parse({ tag }));
      expect((await list(vip)).items.map((c) => c.id)).toEqual([anaId]);

      const retagged = await contactsService.setTags(as(t.carol.id), a1, anaId, { tagIds: [quente] });
      expect(retagged.tags.map((tag) => tag.name)).toEqual(['Lead quente']);
      expect((await list(vip)).items).toEqual([]);
    });

    it('lista tags com contagem de uso', async () => {
      const listed = await settings.listTags(as(t.vic.id), a1);
      expect(listed.map((tag) => [tag.name, tag.usage.contacts])).toEqual([
        ['Lead quente', 1],
        ['VIP', 0],
      ]);
    });

    it('não aplica tag de outro workspace', async () => {
      const filial = await settings.createTag(as(t.alice.id), a2, { name: 'Filial' });
      expect(await statusOf(contactsService.setTags(as(t.alice.id), a1, anaId, { tagIds: [filial.id] })))
        .toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    });

    it('viewer não aplica tag', async () => {
      await expect(contactsService.setTags(as(t.vic.id), a1, anaId, { tagIds: [] })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('empresas também recebem tags', async () => {
      const company = await companiesService.create(as(t.carol.id), a1, createCompanySchema.parse({ name: 'Sol' }));
      const tagged = await companiesService.setTags(as(t.carol.id), a1, company.id, { tagIds: [vip] });
      expect(tagged.tags.map((tag) => tag.name)).toEqual(['VIP']);
    });
  });

  describe('campos customizados', () => {
    beforeAll(async () => {
      await settings.createField(
        as(t.mia.id),
        a1,
        createFieldSchema.parse({ entity: 'contact', label: 'Origem do lead', type: 'select', options: ['Site', 'Indicação'], required: true }),
      );
      await settings.createField(
        as(t.mia.id),
        a1,
        createFieldSchema.parse({ entity: 'contact', label: 'Faturamento anual', type: 'number' }),
      );
    });

    it('gera a chave a partir do rótulo e só manager configura', async () => {
      const fields = await settings.listFields(as(t.carol.id), a1, { entity: 'contact' });
      expect(fields.map((f) => f.key)).toEqual(['faturamento_anual', 'origem_do_lead']);
      expect(
        await statusOf(
          settings.createField(as(t.carol.id), a1, createFieldSchema.parse({ entity: 'contact', label: 'X', type: 'text' })),
        ),
      ).toBe(HttpStatus.FORBIDDEN);
      expect(
        await statusOf(
          settings.createField(as(t.mia.id), a1, createFieldSchema.parse({ entity: 'contact', label: 'Origem do lead', type: 'text' })),
        ),
      ).toBe(HttpStatus.CONFLICT);
    });

    it('exige obrigatórios e valida valores ao criar contato', async () => {
      await expect(
        contactsService.create(as(t.carol.id), a1, createContactSchema.parse({ name: 'Sem origem' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        contactsService.create(as(t.carol.id), a1, createContactSchema.parse({ name: 'X', custom: { origem_do_lead: 'TV' } })),
      ).rejects.toBeInstanceOf(BadRequestException);

      const bruno = await contactsService.create(
        as(t.carol.id),
        a1,
        createContactSchema.parse({ name: 'Bruno', custom: { origem_do_lead: 'Site', faturamento_anual: '120000' } }),
      );
      expect(bruno.custom).toEqual({ origem_do_lead: 'Site', faturamento_anual: 120000 });

      const updated = await contactsService.update(
        as(t.carol.id),
        a1,
        bruno.id,
        updateContactSchema.parse({ custom: { faturamento_anual: null } }),
      );
      expect(updated.custom).toEqual({ origem_do_lead: 'Site' });
    });

    it('campos de outro workspace não valem aqui', async () => {
      await expect(
        contactsService.create(as(t.alice.id), a2, createContactSchema.parse({ name: 'Y', custom: { origem_do_lead: 'Site' } })),
      ).rejects.toBeInstanceOf(BadRequestException);
      const ok = await contactsService.create(as(t.alice.id), a2, createContactSchema.parse({ name: 'Y' }));
      expect(ok.custom).toEqual({});
    });

    it('editar só o nome não esbarra em obrigatório novo', async () => {
      const old = await contactsService.create(
        as(t.carol.id),
        a1,
        createContactSchema.parse({ name: 'Antigo', custom: { origem_do_lead: 'Site' } }),
      );
      await settings.createField(
        as(t.mia.id),
        a1,
        createFieldSchema.parse({ entity: 'contact', label: 'Segmento', type: 'text', required: true }),
      );
      const renamed = await contactsService.update(as(t.carol.id), a1, old.id, updateContactSchema.parse({ name: 'Antigo 2' }));
      expect(renamed.name).toBe('Antigo 2');
    });
  });
});
