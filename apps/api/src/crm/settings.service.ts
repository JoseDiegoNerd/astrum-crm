import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  asc,
  companyTags,
  contactTags,
  count,
  customFieldDefs,
  eq,
  insertRows,
  tags,
  withUserContext,
  type CustomFieldDef,
  type CustomFieldEntity,
  type Database,
  type JwtClaims,
  type SQL,
  type Transaction,
} from '@astrum/db';
import { DATABASE } from '../database/database.module.js';
import type { WorkspaceContext } from '../http/request.js';
import { keyFromLabel } from './custom-fields.js';
import type {
  CreateFieldInput,
  CreateTagInput,
  ListFieldsInput,
  UpdateFieldInput,
  UpdateTagInput,
} from './crm.schemas.js';

/**
 * Configuração do workspace: tags e definições de campos customizados.
 * A RLS só deixa manager (e owner/admin do tenant) escrever; aqui só traduzimos
 * "0 linhas afetadas" em 403/404 legíveis.
 */
@Injectable()
export class SettingsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  listTags(user: JwtClaims, ws: WorkspaceContext) {
    return withUserContext(this.db, user, async (tx) => {
      const rows = await tx
        .select({ tag: tags, contacts: count(contactTags.id) })
        .from(tags)
        .leftJoin(contactTags, eq(contactTags.tagId, tags.id))
        .where(eq(tags.workspaceId, ws.id))
        .groupBy(tags.id)
        .orderBy(asc(tags.name));
      const companyCounts = await tx
        .select({ tagId: companyTags.tagId, companies: count() })
        .from(companyTags)
        .where(eq(companyTags.workspaceId, ws.id))
        .groupBy(companyTags.tagId);
      const byTag = new Map(companyCounts.map((c) => [c.tagId, c.companies]));
      return rows.map((r) => ({ ...r.tag, usage: { contacts: r.contacts, companies: byTag.get(r.tag.id) ?? 0 } }));
    });
  }

  createTag(user: JwtClaims, ws: WorkspaceContext, input: CreateTagInput) {
    return withUserContext(this.db, user, async (tx) => {
      const [tag] = await insertRows(tx, tags, {
        tenantId: ws.tenantId,
        workspaceId: ws.id,
        name: input.name,
        color: input.color,
      });
      return tag!;
    });
  }

  updateTag(user: JwtClaims, ws: WorkspaceContext, id: string, input: UpdateTagInput) {
    return withUserContext(this.db, user, async (tx) => {
      await findOrFail(tx, tags, and(eq(tags.workspaceId, ws.id), eq(tags.id, id))!, 'Tag não encontrada');
      const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      const [tag] = await tx
        .update(tags)
        .set(set)
        .where(and(eq(tags.workspaceId, ws.id), eq(tags.id, id)))
        .returning();
      if (!tag) throw new ForbiddenException('Só managers configuram tags');
      return tag;
    });
  }

  deleteTag(user: JwtClaims, ws: WorkspaceContext, id: string) {
    return withUserContext(this.db, user, async (tx) => {
      await findOrFail(tx, tags, and(eq(tags.workspaceId, ws.id), eq(tags.id, id))!, 'Tag não encontrada');
      const deleted = await tx
        .delete(tags)
        .where(and(eq(tags.workspaceId, ws.id), eq(tags.id, id)))
        .returning({ id: tags.id });
      if (deleted.length === 0) throw new ForbiddenException('Só managers configuram tags');
    });
  }

  listFields(user: JwtClaims, ws: WorkspaceContext, input: ListFieldsInput) {
    return withUserContext(this.db, user, (tx) => fieldsOf(tx, ws, input.entity));
  }

  createField(user: JwtClaims, ws: WorkspaceContext, input: CreateFieldInput) {
    return withUserContext(this.db, user, async (tx) => {
      const [field] = await insertRows(tx, customFieldDefs, {
        tenantId: ws.tenantId,
        workspaceId: ws.id,
        entity: input.entity,
        key: input.key ?? keyFromLabel(input.label),
        label: input.label,
        type: input.type,
        options: input.options,
        required: input.required,
        position: input.position,
      });
      return field!;
    });
  }

  updateField(user: JwtClaims, ws: WorkspaceContext, id: string, input: UpdateFieldInput) {
    return withUserContext(this.db, user, async (tx) => {
      const where = and(eq(customFieldDefs.workspaceId, ws.id), eq(customFieldDefs.id, id))!;
      const current = await findOrFail(tx, customFieldDefs, where, 'Campo não encontrado');
      const hasOptions = current.type === 'select' || current.type === 'multiselect';
      if (input.options && (hasOptions ? input.options.length === 0 : input.options.length > 0)) {
        throw new BadRequestException('Seleção exige opções; os demais tipos não usam opções');
      }
      const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      const [field] = await tx.update(customFieldDefs).set(set).where(where).returning();
      if (!field) throw new ForbiddenException('Só managers configuram campos');
      return field;
    });
  }

  deleteField(user: JwtClaims, ws: WorkspaceContext, id: string) {
    return withUserContext(this.db, user, async (tx) => {
      const where = and(eq(customFieldDefs.workspaceId, ws.id), eq(customFieldDefs.id, id))!;
      await findOrFail(tx, customFieldDefs, where, 'Campo não encontrado');
      // os valores já salvos em custom ficam, mas deixam de ser exibidos e validados
      const deleted = await tx.delete(customFieldDefs).where(where).returning({ id: customFieldDefs.id });
      if (deleted.length === 0) throw new ForbiddenException('Só managers configuram campos');
    });
  }
}

/** Definições de campos do workspace, na ordem de exibição. */
export function fieldsOf(tx: Transaction, ws: WorkspaceContext, entity?: CustomFieldEntity): Promise<CustomFieldDef[]> {
  return tx
    .select()
    .from(customFieldDefs)
    .where(and(eq(customFieldDefs.workspaceId, ws.id), entity ? eq(customFieldDefs.entity, entity) : undefined))
    .orderBy(asc(customFieldDefs.entity), asc(customFieldDefs.position), asc(customFieldDefs.label));
}

async function findOrFail<T extends typeof tags | typeof customFieldDefs>(
  tx: Transaction,
  table: T,
  where: SQL,
  message: string,
): Promise<T['$inferSelect']> {
  const [row] = await tx.select().from(table as typeof tags).where(where);
  if (!row) throw new NotFoundException(message);
  return row as T['$inferSelect'];
}
