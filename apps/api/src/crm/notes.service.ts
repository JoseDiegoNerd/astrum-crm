import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  desc,
  eq,
  insertRows,
  notes,
  profiles,
  sql,
  withUserContext,
  type Database,
  type JwtClaims,
  type SQL,
  type Transaction,
} from '@astrum/db';
import { DATABASE } from '../database/database.module.js';
import type { WorkspaceContext } from '../http/request.js';
import type { CreateNoteInput, ListNotesInput, UpdateNoteInput } from './crm.schemas.js';

@Injectable()
export class NotesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  list(user: JwtClaims, ws: WorkspaceContext, input: ListNotesInput) {
    return withUserContext(this.db, user, (tx) => {
      const where: SQL[] = [eq(notes.workspaceId, ws.id)];
      if (input.contact) where.push(eq(notes.contactId, input.contact));
      if (input.deal) where.push(eq(notes.dealId, input.deal));
      if (input.company) where.push(eq(notes.companyId, input.company));
      return selectNotes(tx, user).where(and(...where)).orderBy(desc(notes.createdAt)).limit(input.limit);
    });
  }

  create(user: JwtClaims, ws: WorkspaceContext, input: CreateNoteInput) {
    return withUserContext(this.db, user, async (tx) => {
      const [note] = await insertRows(tx, notes, {
        tenantId: ws.tenantId,
        workspaceId: ws.id,
        body: input.body,
        contactId: input.contactId,
        dealId: input.dealId,
        companyId: input.companyId,
      });
      return findNote(tx, ws, user, note!.id);
    });
  }

  update(user: JwtClaims, ws: WorkspaceContext, id: string, input: UpdateNoteInput) {
    return withUserContext(this.db, user, async (tx) => {
      await findNote(tx, ws, user, id);
      // a RLS só deixa o autor editar
      const updated = await tx
        .update(notes)
        .set({ body: input.body })
        .where(and(eq(notes.workspaceId, ws.id), eq(notes.id, id)))
        .returning({ id: notes.id });
      if (updated.length === 0) throw new ForbiddenException('Só quem escreveu a nota pode editá-la');
      return findNote(tx, ws, user, id);
    });
  }

  remove(user: JwtClaims, ws: WorkspaceContext, id: string) {
    return withUserContext(this.db, user, async (tx) => {
      await findNote(tx, ws, user, id);
      const deleted = await tx
        .delete(notes)
        .where(and(eq(notes.workspaceId, ws.id), eq(notes.id, id)))
        .returning({ id: notes.id });
      if (deleted.length === 0) throw new ForbiddenException('Só managers podem excluir notas');
    });
  }
}

function selectNotes(tx: Transaction, user: JwtClaims) {
  return tx
    .select({
      id: notes.id,
      body: notes.body,
      contactId: notes.contactId,
      dealId: notes.dealId,
      companyId: notes.companyId,
      createdBy: notes.createdBy,
      authorName: sql<string | null>`coalesce(${profiles.name}, ${profiles.email})`,
      // conveniência para a interface; quem decide de verdade é a RLS
      mine: sql<boolean>`${notes.createdBy} = ${user.sub}::uuid`,
      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .leftJoin(profiles, eq(profiles.id, notes.createdBy))
    .$dynamic();
}

async function findNote(tx: Transaction, ws: WorkspaceContext, user: JwtClaims, id: string) {
  const [note] = await selectNotes(tx, user).where(and(eq(notes.workspaceId, ws.id), eq(notes.id, id)));
  if (!note) throw new NotFoundException('Nota não encontrada');
  return note;
}
