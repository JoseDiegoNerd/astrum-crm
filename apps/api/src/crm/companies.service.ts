import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  asc,
  companies,
  contacts,
  count,
  desc,
  eq,
  ilike,
  insertRows,
  isNotNull,
  isNull,
  or,
  withUserContext,
  type Database,
  type JwtClaims,
  type SQL,
  type Transaction,
} from '@astrum/db';
import { DATABASE } from '../database/database.module.js';
import type { WorkspaceContext } from '../http/request.js';
import type { CreateCompanyInput, ListCompaniesInput, SetTagsInput, UpdateCompanyInput } from './crm.schemas.js';
import { applyCustomFields } from './custom-fields.js';
import { afterCursor, decodeCursor, likePattern, page } from './pagination.js';
import { fieldsOf } from './settings.service.js';
import { hasTag, replaceTags, tagsOf } from './tagging.js';

@Injectable()
export class CompaniesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  list(user: JwtClaims, ws: WorkspaceContext, input: ListCompaniesInput) {
    return withUserContext(this.db, user, async (tx) => {
      const where: SQL[] = [
        eq(companies.workspaceId, ws.id),
        input.archived ? isNotNull(companies.archivedAt) : isNull(companies.archivedAt),
      ];
      if (input.cursor) where.push(afterCursor(companies.createdAt, companies.id, decodeCursor(input.cursor)));
      if (input.tag) where.push(hasTag(tx, 'company', companies.id, input.tag));
      if (input.q) {
        const pattern = likePattern(input.q);
        const digits = input.q.replace(/\D/g, '');
        where.push(
          or(
            ilike(companies.name, pattern),
            ilike(companies.domain, pattern),
            ...(digits.length >= 4 ? [ilike(companies.document, likePattern(digits))] : []),
          )!,
        );
      }

      const rows = await tx
        .select({ company: companies, contactCount: count(contacts.id) })
        .from(companies)
        .leftJoin(contacts, and(eq(contacts.companyId, companies.id), isNull(contacts.archivedAt)))
        .where(and(...where))
        .groupBy(companies.id)
        .orderBy(desc(companies.createdAt), desc(companies.id))
        .limit(input.limit + 1);

      const result = page(rows.map((r) => ({ ...r.company, contactCount: r.contactCount })), input.limit);
      const tagMap = await tagsOf(tx, 'company', result.items.map((c) => c.id));
      return { ...result, items: result.items.map((c) => ({ ...c, tags: tagMap.get(c.id) ?? [] })) };
    });
  }

  get(user: JwtClaims, ws: WorkspaceContext, id: string) {
    return withUserContext(this.db, user, (tx) => findCompany(tx, ws, id));
  }

  create(user: JwtClaims, ws: WorkspaceContext, input: CreateCompanyInput) {
    return withUserContext(this.db, user, async (tx) => {
      const custom = applyCustomFields(await fieldsOf(tx, ws, 'company'), input.custom ?? {});
      const [company] = await insertRows(tx, companies, {
        tenantId: ws.tenantId,
        workspaceId: ws.id,
        name: input.name,
        document: input.document ?? undefined,
        domain: input.domain ?? undefined,
        phone: input.phone ?? undefined,
        ownerId: input.ownerId ?? undefined,
        custom,
      });
      return findCompany(tx, ws, company!.id);
    });
  }

  update(user: JwtClaims, ws: WorkspaceContext, id: string, input: UpdateCompanyInput) {
    return withUserContext(this.db, user, async (tx) => {
      const custom =
        input.custom === undefined
          ? undefined
          : applyCustomFields(await fieldsOf(tx, ws, 'company'), input.custom, (await findCompany(tx, ws, id)).custom);
      await updateOrFail(tx, ws, id, { ...input, custom });
      return findCompany(tx, ws, id);
    });
  }

  setTags(user: JwtClaims, ws: WorkspaceContext, id: string, input: SetTagsInput) {
    return withUserContext(this.db, user, async (tx) => {
      await findCompany(tx, ws, id);
      await replaceTags(tx, ws, 'company', id, input.tagIds);
      return findCompany(tx, ws, id);
    });
  }

  setArchived(user: JwtClaims, ws: WorkspaceContext, id: string, archived: boolean) {
    return withUserContext(this.db, user, async (tx) => {
      await updateOrFail(tx, ws, id, { archivedAt: archived ? new Date() : null });
      return findCompany(tx, ws, id);
    });
  }

  remove(user: JwtClaims, ws: WorkspaceContext, id: string) {
    return withUserContext(this.db, user, async (tx) => {
      await findCompany(tx, ws, id);
      const deleted = await tx
        .delete(companies)
        .where(and(eq(companies.workspaceId, ws.id), eq(companies.id, id)))
        .returning({ id: companies.id });
      if (deleted.length === 0) throw new ForbiddenException('Só managers podem excluir empresas');
    });
  }
}

async function findCompany(tx: Transaction, ws: WorkspaceContext, id: string) {
  const [company] = await tx
    .select()
    .from(companies)
    .where(and(eq(companies.workspaceId, ws.id), eq(companies.id, id)));
  if (!company) throw new NotFoundException('Empresa não encontrada');
  const people = await tx
    .select({ id: contacts.id, name: contacts.name, type: contacts.type })
    .from(contacts)
    .where(and(eq(contacts.companyId, id), isNull(contacts.archivedAt)))
    .orderBy(asc(contacts.name))
    .limit(200);
  const tagMap = await tagsOf(tx, 'company', [id]);
  return { ...company, contacts: people, tags: tagMap.get(id) ?? [] };
}

async function updateOrFail(
  tx: Transaction,
  ws: WorkspaceContext,
  id: string,
  values: Partial<typeof companies.$inferInsert>,
) {
  await findCompany(tx, ws, id);
  const set = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
  const updated = await tx
    .update(companies)
    .set(set)
    .where(and(eq(companies.workspaceId, ws.id), eq(companies.id, id)))
    .returning({ id: companies.id });
  if (updated.length === 0) throw new ForbiddenException('Sem permissão para editar esta empresa');
}
