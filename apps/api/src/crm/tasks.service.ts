import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  asc,
  companies,
  contacts,
  deals,
  desc,
  eq,
  executeRows,
  insertRows,
  isNotNull,
  isNull,
  profiles,
  sql,
  tasks,
  withUserContext,
  workspaces,
  type Database,
  type JwtClaims,
  type SQL,
  type Transaction,
} from '@astrum/db';
import { DATABASE } from '../database/database.module.js';
import type { WorkspaceContext } from '../http/request.js';
import type { CreateTaskInput, ListTasksInput, UpdateTaskInput } from './crm.schemas.js';

export type TaskBucket = 'overdue' | 'today' | 'week' | 'later' | 'none' | 'done';

/**
 * Faixa de prazo calculada no fuso do workspace:
 * atrasada (antes de agora) · hoje · próximos 7 dias · depois · sem prazo · concluída.
 */
function bucketSql(timezone: string) {
  const startOfToday = sql`(date_trunc('day', now() at time zone ${timezone}) at time zone ${timezone})`;
  return sql<TaskBucket>`case
    when ${tasks.doneAt} is not null then 'done'
    when ${tasks.dueAt} is null then 'none'
    when ${tasks.dueAt} < now() then 'overdue'
    when ${tasks.dueAt} < ${startOfToday} + interval '1 day' then 'today'
    when ${tasks.dueAt} < ${startOfToday} + interval '8 days' then 'week'
    else 'later'
  end`;
}

@Injectable()
export class TasksService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  list(user: JwtClaims, ws: WorkspaceContext, input: ListTasksInput) {
    return withUserContext(this.db, user, async (tx) => {
      const where: SQL[] = [eq(tasks.workspaceId, ws.id)];
      if (input.assignee === 'me') where.push(eq(tasks.assigneeId, user.sub));
      else if (input.assignee !== 'any') where.push(eq(tasks.assigneeId, input.assignee));
      if (input.status === 'open') where.push(isNull(tasks.doneAt));
      if (input.status === 'done') where.push(isNotNull(tasks.doneAt));
      if (input.contact) where.push(eq(tasks.contactId, input.contact));
      if (input.deal) where.push(eq(tasks.dealId, input.deal));
      if (input.company) where.push(eq(tasks.companyId, input.company));

      const order =
        input.status === 'done'
          ? [desc(tasks.doneAt)]
          : [sql`${tasks.dueAt} asc nulls last`, asc(tasks.createdAt)];
      return selectTasks(tx, await timezoneOf(tx, ws))
        .where(and(...where))
        .orderBy(...order)
        .limit(input.limit);
    });
  }

  get(user: JwtClaims, ws: WorkspaceContext, id: string) {
    return withUserContext(this.db, user, (tx) => findTask(tx, ws, id));
  }

  create(user: JwtClaims, ws: WorkspaceContext, input: CreateTaskInput) {
    return withUserContext(this.db, user, async (tx) => {
      const [task] = await insertRows(tx, tasks, {
        tenantId: ws.tenantId,
        workspaceId: ws.id,
        title: input.title,
        description: input.description || undefined,
        dueAt: await toInstant(tx, ws, input.dueAt),
        assigneeId: input.assigneeId === undefined ? user.sub : (input.assigneeId ?? undefined),
        contactId: input.contactId ?? undefined,
        dealId: input.dealId ?? undefined,
        companyId: input.companyId ?? undefined,
      });
      return findTask(tx, ws, task!.id);
    });
  }

  update(user: JwtClaims, ws: WorkspaceContext, id: string, input: UpdateTaskInput) {
    return withUserContext(this.db, user, async (tx) => {
      const { dueAt, ...rest } = input;
      await updateOrFail(tx, ws, id, {
        ...rest,
        ...(dueAt !== undefined && { dueAt: (await toInstant(tx, ws, dueAt)) ?? null }),
      });
      return findTask(tx, ws, id);
    });
  }

  setDone(user: JwtClaims, ws: WorkspaceContext, id: string, done: boolean) {
    return withUserContext(this.db, user, async (tx) => {
      await updateOrFail(tx, ws, id, { doneAt: done ? new Date() : null });
      return findTask(tx, ws, id);
    });
  }

  remove(user: JwtClaims, ws: WorkspaceContext, id: string) {
    return withUserContext(this.db, user, async (tx) => {
      await findTask(tx, ws, id);
      const deleted = await tx
        .delete(tasks)
        .where(and(eq(tasks.workspaceId, ws.id), eq(tasks.id, id)))
        .returning({ id: tasks.id });
      if (deleted.length === 0) throw new ForbiddenException('Só managers podem excluir tarefas');
    });
  }
}

function selectTasks(tx: Transaction, timezone: string) {
  return tx
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      dueAt: tasks.dueAt,
      doneAt: tasks.doneAt,
      assigneeId: tasks.assigneeId,
      assigneeName: sql<string | null>`coalesce(${profiles.name}, ${profiles.email})`,
      contactId: tasks.contactId,
      contactName: contacts.name,
      dealId: tasks.dealId,
      dealTitle: deals.title,
      companyId: tasks.companyId,
      companyName: companies.name,
      createdBy: tasks.createdBy,
      createdAt: tasks.createdAt,
      bucket: bucketSql(timezone),
    })
    .from(tasks)
    .leftJoin(profiles, eq(profiles.id, tasks.assigneeId))
    .leftJoin(contacts, eq(contacts.id, tasks.contactId))
    .leftJoin(deals, eq(deals.id, tasks.dealId))
    .leftJoin(companies, eq(companies.id, tasks.companyId))
    .$dynamic();
}

async function findTask(tx: Transaction, ws: WorkspaceContext, id: string) {
  const [task] = await selectTasks(tx, await timezoneOf(tx, ws)).where(
    and(eq(tasks.workspaceId, ws.id), eq(tasks.id, id)),
  );
  if (!task) throw new NotFoundException('Tarefa não encontrada');
  return task;
}

async function timezoneOf(tx: Transaction, ws: WorkspaceContext) {
  const [row] = await tx.select({ timezone: workspaces.timezone }).from(workspaces).where(eq(workspaces.id, ws.id));
  return row?.timezone ?? 'America/Sao_Paulo';
}

/** ISO com fuso é usado como está; horário local é interpretado no fuso do workspace. */
async function toInstant(tx: Transaction, ws: WorkspaceContext, value: string | null | undefined) {
  if (!value) return undefined;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) return new Date(value);
  const [row] = await executeRows<{ at: Date | string }>(
    tx,
    sql`select (${value}::timestamp at time zone ${await timezoneOf(tx, ws)}) as at`,
  );
  return new Date(row!.at);
}

async function updateOrFail(
  tx: Transaction,
  ws: WorkspaceContext,
  id: string,
  values: Partial<typeof tasks.$inferInsert>,
) {
  await findTask(tx, ws, id);
  const set = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
  const updated = await tx
    .update(tasks)
    .set(set)
    .where(and(eq(tasks.workspaceId, ws.id), eq(tasks.id, id)))
    .returning({ id: tasks.id });
  if (updated.length === 0) throw new ForbiddenException('Sem permissão para editar esta tarefa');
}
