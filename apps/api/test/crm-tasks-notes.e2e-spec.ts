import 'reflect-metadata';
import { ForbiddenException, HttpStatus } from '@nestjs/common';
import type { JwtClaims } from '@astrum/db';
import { createTestDatabase, seedTenancy, type Tenancy, type TestDatabase } from '@astrum/db/testing';
import { ContactsService } from '../src/crm/contacts.service.js';
import {
  createContactSchema,
  createNoteSchema,
  createTaskSchema,
  listNotesSchema,
  listTasksSchema,
  updateTaskSchema,
} from '../src/crm/crm.schemas.js';
import { NotesService } from '../src/crm/notes.service.js';
import { TasksService } from '../src/crm/tasks.service.js';
import { toHttpException } from '../src/http/database-error.filter.js';
import type { WorkspaceContext } from '../src/http/request.js';

describe('CRM · tarefas e notas (serviços sob RLS)', () => {
  let testDb: TestDatabase;
  let t: Tenancy;
  let tasksService: TasksService;
  let notesService: NotesService;
  let contactsService: ContactsService;
  let a1: WorkspaceContext;
  let anaId: string;

  const as = (userId: string): JwtClaims => ({ sub: userId, role: 'authenticated' });
  const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  const newTask = (userId: string, input: Record<string, unknown>) =>
    tasksService.create(as(userId), a1, createTaskSchema.parse(input));

  beforeAll(async () => {
    testDb = await createTestDatabase();
    t = await seedTenancy(testDb);
    const db = testDb.drizzle();
    tasksService = new TasksService(db);
    notesService = new NotesService(db);
    contactsService = new ContactsService(db);
    a1 = { id: t.a1, tenantId: t.tenantA };
    anaId = (await contactsService.create(as(t.carol.id), a1, createContactSchema.parse({ name: 'Ana' }))).id;
  });

  afterAll(async () => {
    await testDb?.close();
  });

  describe('tarefas', () => {
    it('quem cria é o responsável por padrão; o vínculo traz o nome', async () => {
      const task = await newTask(t.carol.id, { title: 'Ligar para Ana', contactId: anaId });
      expect(task).toMatchObject({ assigneeId: t.carol.id, contactName: 'Ana', bucket: 'none', doneAt: null });
    });

    it('classifica por prazo no fuso do workspace', async () => {
      const titles = { atrasada: inHours(-2), semana: inHours(72), depois: inHours(24 * 30) };
      for (const [title, dueAt] of Object.entries(titles)) await newTask(t.carol.id, { title, dueAt });
      const soon = await newTask(t.carol.id, { title: 'logo', dueAt: inHours(0.02) });

      const mine = await tasksService.list(as(t.carol.id), a1, listTasksSchema.parse({}));
      const bucketOf = (title: string) => mine.find((x) => x.title === title)?.bucket;
      expect(bucketOf('atrasada')).toBe('overdue');
      expect(bucketOf('semana')).toBe('week');
      expect(bucketOf('depois')).toBe('later');
      // daqui a ~1 minuto: hoje (ou amanhã, se o teste rodar à meia-noite)
      expect(['today', 'week']).toContain(soon.bucket);
      // ordenadas por prazo, sem prazo no fim
      expect(mine.at(-1)?.bucket).toBe('none');
      expect(mine[0]?.title).toBe('atrasada');
    });

    it('horário local é interpretado no fuso do workspace (São Paulo, UTC-3)', async () => {
      const task = await newTask(t.carol.id, { title: 'Reunião', dueAt: '2026-12-01T09:00' });
      expect(new Date(task.dueAt!).toISOString()).toBe('2026-12-01T12:00:00.000Z');
    });

    it('conclui, reabre e lista concluídas', async () => {
      const task = await newTask(t.carol.id, { title: 'Enviar proposta' });
      const done = await tasksService.setDone(as(t.carol.id), a1, task.id, true);
      expect(done.bucket).toBe('done');
      const doneList = await tasksService.list(as(t.carol.id), a1, listTasksSchema.parse({ status: 'done' }));
      expect(doneList.map((x) => x.id)).toEqual([task.id]);
      expect((await tasksService.setDone(as(t.carol.id), a1, task.id, false)).doneAt).toBeNull();
    });

    it('filtra por responsável e por contato', async () => {
      await newTask(t.carol.id, { title: 'Para a mia', assigneeId: t.mia.id });
      const miaTasks = await tasksService.list(as(t.mia.id), a1, listTasksSchema.parse({}));
      expect(miaTasks.map((x) => x.title)).toEqual(['Para a mia']);

      const byContact = await tasksService.list(as(t.vic.id), a1, listTasksSchema.parse({ assignee: 'any', contact: anaId }));
      expect(byContact.map((x) => x.title)).toEqual(['Ligar para Ana']);
    });

    it('responsável fora da conta é recusado', async () => {
      const error = await newTask(t.carol.id, { title: 'X', assigneeId: t.bob.id }).catch((e) => e);
      expect(toHttpException(error)?.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(toHttpException(error)?.message).toBe('O responsável precisa ser membro da conta');
    });

    it('viewer não edita; agent não exclui', async () => {
      const task = await newTask(t.carol.id, { title: 'Protegida' });
      await expect(
        tasksService.update(as(t.vic.id), a1, task.id, updateTaskSchema.parse({ title: 'hack' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(tasksService.remove(as(t.carol.id), a1, task.id)).rejects.toBeInstanceOf(ForbiddenException);
      await tasksService.remove(as(t.mia.id), a1, task.id);
    });
  });

  describe('notas', () => {
    it('lista as notas do contato com autor, mais recente primeiro', async () => {
      await notesService.create(as(t.carol.id), a1, createNoteSchema.parse({ body: 'Primeira', contactId: anaId }));
      await notesService.create(as(t.mia.id), a1, createNoteSchema.parse({ body: 'Segunda', contactId: anaId }));
      const list = await notesService.list(as(t.carol.id), a1, listNotesSchema.parse({ contact: anaId }));
      expect(list.map((n) => [n.body, n.mine])).toEqual([
        ['Segunda', false],
        ['Primeira', true],
      ]);
      expect(list[1]!.authorName).toContain('carol');
    });

    it('só o autor edita', async () => {
      const [segunda] = await notesService.list(as(t.carol.id), a1, listNotesSchema.parse({ contact: anaId }));
      await expect(notesService.update(as(t.carol.id), a1, segunda!.id, { body: 'hack' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      const edited = await notesService.update(as(t.mia.id), a1, segunda!.id, { body: 'Segunda (revisada)' });
      expect(edited.body).toBe('Segunda (revisada)');
    });

    it('nota exige assunto', () => {
      expect(() => createNoteSchema.parse({ body: 'solta' })).toThrow(/contato, negócio ou empresa/);
    });
  });
});
