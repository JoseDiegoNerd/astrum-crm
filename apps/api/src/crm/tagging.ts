import { ForbiddenException } from '@nestjs/common';
import {
  and,
  asc,
  companyTags,
  contactTags,
  eq,
  exists,
  inArray,
  insertRows,
  sql,
  tags,
  type AnyPgColumn,
  type SQL,
  type Tag,
  type Transaction,
} from '@astrum/db';
import type { WorkspaceContext } from '../http/request.js';

// contact_tags e company_tags têm o mesmo formato; muda só a coluna do "dono".
const JUNCTIONS = {
  contact: { table: contactTags, owner: contactTags.contactId },
  company: { table: companyTags, owner: companyTags.companyId },
} as const;

export type TaggedEntity = keyof typeof JUNCTIONS;
export type TagSummary = Pick<Tag, 'id' | 'name' | 'color'>;

// As duas junções têm as mesmas colunas usadas aqui; o cast evita uniões que o Drizzle não aceita.
const tableOf = (entity: TaggedEntity) => JUNCTIONS[entity].table as typeof contactTags;

/** Tags de cada registro, em ordem alfabética. */
export async function tagsOf(tx: Transaction, entity: TaggedEntity, ids: string[]) {
  const byOwner = new Map<string, TagSummary[]>();
  if (ids.length === 0) return byOwner;
  const { owner } = JUNCTIONS[entity];
  const junction = tableOf(entity);
  const rows = await tx
    .select({ ownerId: owner, id: tags.id, name: tags.name, color: tags.color })
    .from(junction)
    .innerJoin(tags, eq(tags.id, junction.tagId))
    .where(inArray(owner, ids))
    .orderBy(asc(tags.name));
  for (const { ownerId, ...tag } of rows) {
    byOwner.set(ownerId, [...(byOwner.get(ownerId) ?? []), tag]);
  }
  return byOwner;
}

/** Condição "tem a tag" para filtrar listas. */
export function hasTag(tx: Transaction, entity: TaggedEntity, ownerColumn: AnyPgColumn, tagId: string): SQL {
  const { owner } = JUNCTIONS[entity];
  const junction = tableOf(entity);
  return exists(
    tx
      .select({ one: sql`1` })
      .from(junction)
      .where(and(eq(owner, ownerColumn), eq(junction.tagId, tagId))),
  );
}

/** Substitui o conjunto de tags do registro pelo informado (aplica e remove só a diferença). */
export async function replaceTags(
  tx: Transaction,
  ws: WorkspaceContext,
  entity: TaggedEntity,
  ownerId: string,
  tagIds: string[],
) {
  const { owner } = JUNCTIONS[entity];
  const junction = tableOf(entity);
  const current = (await tx.select({ tagId: junction.tagId }).from(junction).where(eq(owner, ownerId))).map(
    (r) => r.tagId,
  );
  const toRemove = current.filter((id) => !tagIds.includes(id));
  const toAdd = tagIds.filter((id) => !current.includes(id));

  if (toRemove.length > 0) {
    const removed = await tx
      .delete(junction)
      .where(and(eq(owner, ownerId), inArray(junction.tagId, toRemove)))
      .returning({ id: junction.id });
    if (removed.length !== toRemove.length) throw new ForbiddenException('Sem permissão para alterar tags');
  }
  for (const tagId of toAdd) {
    // FK (workspace_id, tag_id) recusa tag de outro workspace → 422 pelo filtro de erros
    const base = { tenantId: ws.tenantId, workspaceId: ws.id, tagId };
    if (entity === 'contact') await insertRows(tx, contactTags, { ...base, contactId: ownerId });
    else await insertRows(tx, companyTags, { ...base, companyId: ownerId });
  }
}
