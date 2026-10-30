import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  asc,
  companies,
  contactIdentities,
  contacts,
  desc,
  eq,
  inArray,
  insertRows,
  isNotNull,
  isNull,
  ne,
  sql,
  withUserContext,
  type ContactIdentity,
  type Database,
  type JwtClaims,
  type SQL,
  type Transaction,
} from '@astrum/db';
import { DATABASE } from '../database/database.module.js';
import type { WorkspaceContext } from '../http/request.js';
import type {
  CreateContactInput,
  IdentityInput,
  ListContactsInput,
  SetTagsInput,
  UpdateContactInput,
} from './crm.schemas.js';
import { applyCustomFields } from './custom-fields.js';
import { afterCursor, decodeCursor, page } from './pagination.js';
import { fieldsOf } from './settings.service.js';
import { hasTag, replaceTags, tagsOf } from './tagging.js';

// Toda consulta roda em withUserContext: a RLS decide o que o usuário vê.
// O filtro por workspace_id restringe ao workspace do header (owner/admin
// enxergam todos os workspaces do tenant).
@Injectable()
export class ContactsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  list(user: JwtClaims, ws: WorkspaceContext, input: ListContactsInput) {
    return withUserContext(this.db, user, async (tx) => {
      const where: SQL[] = [
        eq(contacts.workspaceId, ws.id),
        input.archived ? isNotNull(contacts.archivedAt) : isNull(contacts.archivedAt),
      ];
      if (input.type) where.push(eq(contacts.type, input.type));
      if (input.companyId) where.push(eq(contacts.companyId, input.companyId));
      if (input.tag) where.push(hasTag(tx, 'contact', contacts.id, input.tag));
      if (input.cursor) where.push(afterCursor(contacts.createdAt, contacts.id, decodeCursor(input.cursor)));
      if (input.q) where.push(searchCondition(ws, input.q));

      const rows = await tx
        .select({ contact: contacts, companyName: companies.name })
        .from(contacts)
        .leftJoin(companies, eq(companies.id, contacts.companyId))
        .where(and(...where))
        .orderBy(desc(contacts.createdAt), desc(contacts.id))
        .limit(input.limit + 1);

      const { items, nextCursor } = page(
        rows.map((r) => ({ ...r.contact, companyName: r.companyName })),
        input.limit,
      );
      const ids = items.map((c) => c.id);
      const [identities, tagMap] = await Promise.all([identitiesOf(tx, ids), tagsOf(tx, 'contact', ids)]);
      return {
        items: items.map((c) => ({ ...c, identities: identities.get(c.id) ?? [], tags: tagMap.get(c.id) ?? [] })),
        nextCursor,
      };
    });
  }

  get(user: JwtClaims, ws: WorkspaceContext, id: string) {
    return withUserContext(this.db, user, (tx) => findContact(tx, ws, id));
  }

  create(user: JwtClaims, ws: WorkspaceContext, input: CreateContactInput) {
    return withUserContext(this.db, user, async (tx) => {
      await assertIdentitiesFree(tx, ws, input.identities);
      const custom = applyCustomFields(await fieldsOf(tx, ws, 'contact'), input.custom ?? {});
      const [contact] = await insertRows(tx, contacts, {
        tenantId: ws.tenantId,
        workspaceId: ws.id,
        name: input.name,
        type: input.type,
        companyId: input.companyId ?? undefined,
        ownerId: input.ownerId ?? undefined,
        lgpdStatus: input.lgpdStatus,
        custom,
      });

      const primaryTaken = new Set<string>();
      for (const identity of input.identities) {
        // primeira identidade de cada canal vira a principal, se nada for dito
        const isPrimary = identity.isPrimary ?? !primaryTaken.has(identity.channel);
        if (isPrimary) primaryTaken.add(identity.channel);
        await insertRows(tx, contactIdentities, {
          tenantId: ws.tenantId,
          workspaceId: ws.id,
          contactId: contact!.id,
          channel: identity.channel,
          identifier: identity.identifier,
          isPrimary,
        });
      }
      return findContact(tx, ws, contact!.id);
    });
  }

  update(user: JwtClaims, ws: WorkspaceContext, id: string, input: UpdateContactInput) {
    return withUserContext(this.db, user, async (tx) => {
      // custom chega como alteração parcial e é mesclado ao que já existe
      const custom =
        input.custom === undefined
          ? undefined
          : applyCustomFields(await fieldsOf(tx, ws, 'contact'), input.custom, (await findContact(tx, ws, id)).custom);
      await updateOrFail(tx, ws, id, {
        name: input.name,
        type: input.type,
        companyId: input.companyId,
        ownerId: input.ownerId,
        lgpdStatus: input.lgpdStatus,
        custom,
      });
      return findContact(tx, ws, id);
    });
  }

  setTags(user: JwtClaims, ws: WorkspaceContext, id: string, input: SetTagsInput) {
    return withUserContext(this.db, user, async (tx) => {
      await findContact(tx, ws, id);
      await replaceTags(tx, ws, 'contact', id, input.tagIds);
      return findContact(tx, ws, id);
    });
  }

  setArchived(user: JwtClaims, ws: WorkspaceContext, id: string, archived: boolean) {
    return withUserContext(this.db, user, async (tx) => {
      await updateOrFail(tx, ws, id, { archivedAt: archived ? new Date() : null });
      return findContact(tx, ws, id);
    });
  }

  remove(user: JwtClaims, ws: WorkspaceContext, id: string) {
    return withUserContext(this.db, user, async (tx) => {
      await findContact(tx, ws, id);
      const deleted = await tx
        .delete(contacts)
        .where(and(eq(contacts.workspaceId, ws.id), eq(contacts.id, id)))
        .returning({ id: contacts.id });
      if (deleted.length === 0) throw new ForbiddenException('Só managers podem excluir contatos');
    });
  }

  addIdentity(user: JwtClaims, ws: WorkspaceContext, contactId: string, input: IdentityInput) {
    return withUserContext(this.db, user, async (tx) => {
      const contact = await findContact(tx, ws, contactId);
      await assertIdentitiesFree(tx, ws, [input]);
      const isPrimary = input.isPrimary ?? !contact.identities.some((i) => i.channel === input.channel);
      if (isPrimary) await clearPrimary(tx, contactId, input.channel);
      await insertRows(tx, contactIdentities, {
        tenantId: ws.tenantId,
        workspaceId: ws.id,
        contactId,
        channel: input.channel,
        identifier: input.identifier,
        isPrimary,
      });
      return findContact(tx, ws, contactId);
    });
  }

  makePrimary(user: JwtClaims, ws: WorkspaceContext, contactId: string, identityId: string) {
    return withUserContext(this.db, user, async (tx) => {
      const contact = await findContact(tx, ws, contactId);
      const identity = contact.identities.find((i) => i.id === identityId);
      if (!identity) throw new NotFoundException('Identidade não encontrada');
      await clearPrimary(tx, contactId, identity.channel, identityId);
      const updated = await tx
        .update(contactIdentities)
        .set({ isPrimary: true })
        .where(eq(contactIdentities.id, identityId))
        .returning({ id: contactIdentities.id });
      if (updated.length === 0) throw new ForbiddenException('Sem permissão para editar este contato');
      return findContact(tx, ws, contactId);
    });
  }

  removeIdentity(user: JwtClaims, ws: WorkspaceContext, contactId: string, identityId: string) {
    return withUserContext(this.db, user, async (tx) => {
      const contact = await findContact(tx, ws, contactId);
      if (!contact.identities.some((i) => i.id === identityId)) {
        throw new NotFoundException('Identidade não encontrada');
      }
      const deleted = await tx
        .delete(contactIdentities)
        .where(eq(contactIdentities.id, identityId))
        .returning({ id: contactIdentities.id });
      if (deleted.length === 0) throw new ForbiddenException('Sem permissão para editar este contato');
      return findContact(tx, ws, contactId);
    });
  }
}

async function findContact(tx: Transaction, ws: WorkspaceContext, id: string) {
  const [row] = await tx
    .select({ contact: contacts, company: { id: companies.id, name: companies.name } })
    .from(contacts)
    .leftJoin(companies, eq(companies.id, contacts.companyId))
    .where(and(eq(contacts.workspaceId, ws.id), eq(contacts.id, id)));
  if (!row) throw new NotFoundException('Contato não encontrado');
  const [identities, tagMap] = await Promise.all([identitiesOf(tx, [id]), tagsOf(tx, 'contact', [id])]);
  return {
    ...row.contact,
    company: row.company?.id ? row.company : null,
    identities: identities.get(id) ?? [],
    tags: tagMap.get(id) ?? [],
  };
}

async function identitiesOf(tx: Transaction, contactIds: string[]) {
  const byContact = new Map<string, ContactIdentity[]>();
  if (contactIds.length === 0) return byContact;
  const rows = await tx
    .select()
    .from(contactIdentities)
    .where(inArray(contactIdentities.contactId, contactIds))
    .orderBy(asc(contactIdentities.channel), desc(contactIdentities.isPrimary), asc(contactIdentities.createdAt));
  for (const row of rows) {
    byContact.set(row.contactId, [...(byContact.get(row.contactId) ?? []), row]);
  }
  return byContact;
}

/** Nome do contato ou qualquer identidade (telefone também casa só pelos dígitos). */
/**
 * Nome do contato ou qualquer identidade (telefone também casa só pelos dígitos).
 * Usa private.search_contact_ids: com RLS o Postgres não usa índice para ILIKE,
 * então a função confere o acesso ao workspace e busca pelos índices de trigramas
 * (ver migration crm_search_indexes). Esta consulta continua sob RLS.
 */
function searchCondition(ws: WorkspaceContext, term: string): SQL {
  const digits = term.replace(/\D/g, '');
  const phoneLike = digits.length >= 4 && digits.length === term.replace(/[\s()+.-]/g, '').length;
  const identifierTerm = phoneLike ? digits : term.toLowerCase().replace(/^@/, '');
  return sql`${contacts.id} in (select private.search_contact_ids(${ws.id}::uuid, ${term}, ${identifierTerm}))`;
}

/** Recusa identidades que já pertencem a algum contato do workspace, dizendo qual. */
async function assertIdentitiesFree(tx: Transaction, ws: WorkspaceContext, identities: IdentityInput[]) {
  for (const identity of identities) {
    const [existing] = await tx
      .select({ contactId: contacts.id, name: contacts.name })
      .from(contactIdentities)
      .innerJoin(contacts, eq(contacts.id, contactIdentities.contactId))
      .where(
        and(
          eq(contactIdentities.workspaceId, ws.id),
          eq(contactIdentities.channel, identity.channel),
          eq(contactIdentities.identifier, identity.identifier),
        ),
      );
    if (existing) {
      throw new ConflictException({
        message: `${identity.identifier} já pertence ao contato "${existing.name}"`,
        contactId: existing.contactId,
      });
    }
  }
}

async function clearPrimary(tx: Transaction, contactId: string, channel: ContactIdentity['channel'], exceptId?: string) {
  await tx
    .update(contactIdentities)
    .set({ isPrimary: false })
    .where(
      and(
        eq(contactIdentities.contactId, contactId),
        eq(contactIdentities.channel, channel),
        eq(contactIdentities.isPrimary, true),
        ...(exceptId ? [ne(contactIdentities.id, exceptId)] : []),
      ),
    );
}

async function updateOrFail(
  tx: Transaction,
  ws: WorkspaceContext,
  id: string,
  values: Partial<typeof contacts.$inferInsert>,
) {
  await findContact(tx, ws, id);
  const set = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
  const updated = await tx
    .update(contacts)
    .set(set)
    .where(and(eq(contacts.workspaceId, ws.id), eq(contacts.id, id)))
    .returning({ id: contacts.id });
  if (updated.length === 0) throw new ForbiddenException('Sem permissão para editar este contato');
}
