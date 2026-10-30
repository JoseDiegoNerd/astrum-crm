import 'reflect-metadata';
import type { JwtClaims } from '@astrum/db';
import { createTestDatabase, seedTenancy, type Tenancy, type TestDatabase } from '@astrum/db/testing';
import { ContactsService } from '../src/crm/contacts.service.js';
import {
  createContactSchema,
  createDealSchema,
  createNoteSchema,
  createTaskSchema,
  moveDealSchema,
  timelineSchema,
} from '../src/crm/crm.schemas.js';
import { DealsService } from '../src/crm/deals.service.js';
import { NotesService } from '../src/crm/notes.service.js';
import { TasksService } from '../src/crm/tasks.service.js';
import { TimelineService } from '../src/crm/timeline.service.js';
import type { WorkspaceContext } from '../src/http/request.js';

// O fluxo real (serviços da API) gera a linha do tempo pelos triggers do banco.
describe('CRM · linha do tempo (serviços sob RLS)', () => {
  let testDb: TestDatabase;
  let t: Tenancy;
  let timeline: TimelineService;
  let a1: WorkspaceContext;
  let contactId: string;
  let dealId: string;

  const as = (userId: string): JwtClaims => ({ sub: userId, role: 'authenticated' });

  beforeAll(async () => {
    testDb = await createTestDatabase();
    t = await seedTenancy(testDb);
    const db = testDb.drizzle();
    const contacts = new ContactsService(db);
    const deals = new DealsService(db);
    const tasks = new TasksService(db);
    const notes = new NotesService(db);
    timeline = new TimelineService(db);
    a1 = { id: t.a1, tenantId: t.tenantA };

    contactId = (await contacts.create(as(t.carol.id), a1, createContactSchema.parse({ name: 'Ana' }))).id;
    const deal = await deals.create(as(t.carol.id), a1, createDealSchema.parse({ title: 'Plano anual', contactId, valueCents: 50000 }));
    dealId = deal.id;
    const board = await deals.board(as(t.carol.id), a1, {});
    const won = board.columns.find((c) => c.kind === 'won')!;
    await deals.move(as(t.mia.id), a1, deal.id, moveDealSchema.parse({ stageId: won.id }));
    const task = await tasks.create(as(t.carol.id), a1, createTaskSchema.parse({ title: 'Enviar contrato', contactId }));
    await tasks.setDone(as(t.carol.id), a1, task.id, true);
    await notes.create(as(t.carol.id), a1, createNoteSchema.parse({ body: 'Assinou hoje.', contactId }));
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it('mostra tudo o que aconteceu com o contato, mais recente primeiro, com quem fez', async () => {
    const { items } = await timeline.list(as(t.vic.id), a1, timelineSchema.parse({ contact: contactId }));
    expect(items.map((e) => e.type)).toEqual([
      'note.added',
      'task.completed',
      'task.created',
      'deal.won',
      'deal.created',
      'contact.created',
    ]);
    const won = items.find((e) => e.type === 'deal.won')!;
    expect(won.actorName).toContain('mia');
    expect(won.payload).toMatchObject({ title: 'Plano anual', from: 'Novo', to: 'Ganho' });
  });

  it('linha do tempo do negócio traz só os eventos dele', async () => {
    const { items } = await timeline.list(as(t.carol.id), a1, timelineSchema.parse({ deal: dealId }));
    expect(items.map((e) => e.type)).toEqual(['deal.won', 'deal.created']);
  });

  it('pagina com cursor', async () => {
    const first = await timeline.list(as(t.carol.id), a1, timelineSchema.parse({ contact: contactId, limit: '4' }));
    expect(first.items).toHaveLength(4);
    const second = await timeline.list(
      as(t.carol.id),
      a1,
      timelineSchema.parse({ contact: contactId, limit: '4', cursor: first.nextCursor! }),
    );
    expect(second.items.map((e) => e.type)).toEqual(['deal.created', 'contact.created']);
    expect(second.nextCursor).toBeNull();
  });

  it('outro tenant não vê nada', async () => {
    const { items } = await timeline.list(as(t.bob.id), a1, timelineSchema.parse({ contact: contactId }));
    expect(items).toEqual([]);
  });
});
