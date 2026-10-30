import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  and,
  companies,
  contactIdentities,
  contactTags,
  contacts,
  eq,
  isNull,
  insertRows,
  or,
  sql,
  tags,
  withUserContext,
  type ContactType,
  type Database,
  type IdentityChannel,
  type JwtClaims,
  type Transaction,
} from '@astrum/db';
import { DATABASE } from '../database/database.module.js';
import { toHttpException } from '../http/database-error.filter.js';
import type { WorkspaceContext } from '../http/request.js';
import { applyCustomFields } from './custom-fields.js';
import type { ImportContactsInput } from './crm.schemas.js';
import { parseCsv } from './csv.js';
import { InvalidIdentityError, normalizeIdentity } from './identity.js';
import { fieldsOf } from './settings.service.js';
import { replaceTags } from './tagging.js';

export const MAX_IMPORT_ROWS = 5000;

type Column = 'name' | 'email' | 'phone' | 'whatsapp' | 'instagram' | 'company' | 'type' | 'tags';

// Cabeçalhos aceitos (comparados sem acento, em minúsculas)
const HEADER_ALIASES: Record<Column, string[]> = {
  name: ['nome', 'name', 'nome completo', 'contato', 'cliente'],
  email: ['email', 'e-mail', 'e mail', 'correio'],
  phone: ['telefone', 'phone', 'fone', 'tel', 'telefone fixo'],
  whatsapp: ['whatsapp', 'whats', 'wpp', 'celular', 'mobile', 'telefone celular'],
  instagram: ['instagram', 'ig', 'insta'],
  company: ['empresa', 'company', 'organizacao', 'organization', 'razao social'],
  type: ['tipo', 'type'],
  tags: ['tags', 'tag', 'etiquetas', 'etiqueta'],
};

const IDENTITY_COLUMNS: [Column, IdentityChannel][] = [
  ['whatsapp', 'whatsapp'],
  ['phone', 'phone'],
  ['email', 'email'],
  ['instagram', 'instagram'],
];

const TYPE_ALIASES: Record<string, ContactType> = {
  lead: 'lead',
  cliente: 'customer',
  customer: 'customer',
  outro: 'other',
  other: 'other',
};

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

export interface ImportReport {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  columns: Partial<Record<Column, string>>;
  ignoredColumns: string[];
  errors: { line: number; message: string }[];
  warnings: string[];
}

class RowError extends Error {}

@Injectable()
export class ImportService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async importContacts(user: JwtClaims, ws: WorkspaceContext, input: ImportContactsInput): Promise<ImportReport> {
    const { headers, rows } = parseCsv(input.csv);
    const columnIndex = mapColumns(headers);
    if (columnIndex.name === undefined) {
      throw new BadRequestException('O arquivo precisa de uma coluna "Nome"');
    }
    if (rows.length === 0) throw new BadRequestException('O arquivo não tem linhas de dados');
    if (rows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(`Máximo de ${MAX_IMPORT_ROWS} linhas por arquivo (este tem ${rows.length})`);
    }

    const report: ImportReport = {
      total: rows.length,
      created: 0,
      updated: 0,
      skipped: 0,
      columns: Object.fromEntries(Object.entries(columnIndex).map(([col, i]) => [col, headers[i]!])),
      ignoredColumns: headers.filter((_, i) => !Object.values(columnIndex).includes(i)),
      errors: [],
      warnings: [],
    };

    return withUserContext(this.db, user, async (tx) => {
      const defs = await fieldsOf(tx, ws, 'contact');
      const tagByName = new Map(
        (await tx.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.workspaceId, ws.id))).map(
          (t) => [fold(t.name), t.id],
        ),
      );
      const unknownTags = new Set<string>();
      const companyCache = new Map<string, string>();
      const cell = (row: string[], column: Column) => {
        const i = columnIndex[column];
        return i === undefined ? '' : (row[i] ?? '').trim();
      };

      for (const [index, row] of rows.entries()) {
        const line = index + 2; // linha 1 é o cabeçalho
        try {
          // savepoint: erro numa linha desfaz só ela
          const outcome = await tx.transaction(async (sp) => {
            const name = cell(row, 'name');
            if (!name) throw new RowError('Nome vazio');
            if (name.length > 200) throw new RowError('Nome com mais de 200 caracteres');

            const identities = IDENTITY_COLUMNS.flatMap(([column, channel]) => {
              const raw = cell(row, column);
              if (!raw) return [];
              try {
                return [{ channel, identifier: normalizeIdentity(channel, raw) }];
              } catch (error) {
                if (error instanceof InvalidIdentityError) throw new RowError(`${error.message}: "${raw}"`);
                throw error;
              }
            });

            const existingId = await findExisting(sp, ws, identities);
            if (existingId && input.mode === 'skip') return 'skipped' as const;

            const companyName = cell(row, 'company');
            const companyId = companyName ? await companyFor(sp, ws, companyName, companyCache) : undefined;
            const tagIds = splitTags(cell(row, 'tags')).flatMap((tag) => {
              const id = tagByName.get(fold(tag));
              if (!id) unknownTags.add(tag);
              return id ? [id] : [];
            });

            if (existingId) {
              await mergeInto(sp, ws, existingId, identities, companyId, tagIds);
              return 'updated' as const;
            }

            const typeRaw = fold(cell(row, 'type'));
            const type = typeRaw ? TYPE_ALIASES[typeRaw] : undefined;
            if (typeRaw && !type) throw new RowError(`Tipo desconhecido: "${cell(row, 'type')}" (use Lead, Cliente ou Outro)`);

            const [contact] = await insertRows(sp, contacts, {
              tenantId: ws.tenantId,
              workspaceId: ws.id,
              name,
              type,
              companyId,
              custom: applyCustomFields(defs, {}),
            });
            await addIdentities(sp, ws, contact!.id, identities, new Set());
            if (tagIds.length) await replaceTags(sp, ws, 'contact', contact!.id, [...new Set(tagIds)]);
            return 'created' as const;
          });
          report[outcome]++;
        } catch (error) {
          const message =
            error instanceof RowError
              ? error.message
              : (toHttpException(error)?.message ?? (error instanceof Error ? error.message : 'Erro inesperado'));
          if (report.errors.length < 100) report.errors.push({ line, message });
          else if (report.errors.length === 100) report.warnings.push('Mais de 100 linhas com erro; mostrando as 100 primeiras');
        }
      }

      if (unknownTags.size > 0) {
        report.warnings.push(
          `Tags não encontradas (crie em Configurações e importe de novo): ${[...unknownTags].slice(0, 20).join(', ')}`,
        );
      }
      return report;
    });
  }
}

function mapColumns(headers: string[]): Partial<Record<Column, number>> {
  const result: Partial<Record<Column, number>> = {};
  headers.forEach((header, index) => {
    const key = fold(header);
    for (const [column, aliases] of Object.entries(HEADER_ALIASES) as [Column, string[]][]) {
      if (result[column] === undefined && aliases.includes(key)) {
        result[column] = index;
        return;
      }
    }
  });
  return result;
}

const splitTags = (value: string) =>
  value
    .split(/[|,]/)
    .map((t) => t.trim())
    .filter(Boolean);

/** Contato do workspace que já tem alguma destas identidades. */
async function findExisting(
  tx: Transaction,
  ws: WorkspaceContext,
  identities: { channel: IdentityChannel; identifier: string }[],
) {
  if (identities.length === 0) return undefined;
  const [match] = await tx
    .select({ contactId: contactIdentities.contactId })
    .from(contactIdentities)
    .where(
      and(
        eq(contactIdentities.workspaceId, ws.id),
        or(
          ...identities.map((i) =>
            and(eq(contactIdentities.channel, i.channel), eq(contactIdentities.identifier, i.identifier)),
          ),
        ),
      ),
    )
    .limit(1);
  return match?.contactId;
}

/** Empresa pelo nome (sem diferenciar maiúsculas); cria se não existir. */
async function companyFor(tx: Transaction, ws: WorkspaceContext, name: string, cache: Map<string, string>) {
  const key = fold(name);
  const cached = cache.get(key);
  if (cached) return cached;
  const [existing] = await tx
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.workspaceId, ws.id), sql`lower(${companies.name}) = lower(${name.trim()})`))
    .limit(1);
  const id = existing?.id ?? (await insertRows(tx, companies, { tenantId: ws.tenantId, workspaceId: ws.id, name: name.trim() }))[0]!.id;
  cache.set(key, id);
  return id;
}

async function addIdentities(
  tx: Transaction,
  ws: WorkspaceContext,
  contactId: string,
  identities: { channel: IdentityChannel; identifier: string }[],
  channelsWithPrimary: Set<IdentityChannel>,
) {
  for (const identity of identities) {
    const isPrimary = !channelsWithPrimary.has(identity.channel);
    channelsWithPrimary.add(identity.channel);
    await insertRows(tx, contactIdentities, { tenantId: ws.tenantId, workspaceId: ws.id, contactId, ...identity, isPrimary });
  }
}

/** Modo "mesclar": completa canais, empresa (se vazia) e tags do contato existente. */
async function mergeInto(
  tx: Transaction,
  ws: WorkspaceContext,
  contactId: string,
  identities: { channel: IdentityChannel; identifier: string }[],
  companyId: string | undefined,
  tagIds: string[],
) {
  // identidades que já existem no workspace (deste ou de outro contato) ficam de fora
  const taken = identities.length
    ? await tx
        .select({ channel: contactIdentities.channel, identifier: contactIdentities.identifier })
        .from(contactIdentities)
        .where(
          and(
            eq(contactIdentities.workspaceId, ws.id),
            or(
              ...identities.map((i) =>
                and(eq(contactIdentities.channel, i.channel), eq(contactIdentities.identifier, i.identifier)),
              ),
            ),
          ),
        )
    : [];
  const takenKeys = new Set(taken.map((i) => `${i.channel}:${i.identifier}`));
  const primaries = await tx
    .select({ channel: contactIdentities.channel })
    .from(contactIdentities)
    .where(and(eq(contactIdentities.contactId, contactId), eq(contactIdentities.isPrimary, true)));
  await addIdentities(
    tx,
    ws,
    contactId,
    identities.filter((i) => !takenKeys.has(`${i.channel}:${i.identifier}`)),
    new Set(primaries.map((p) => p.channel)),
  );

  if (companyId) {
    await tx
      .update(contacts)
      .set({ companyId })
      .where(and(eq(contacts.id, contactId), isNull(contacts.companyId)));
  }
  if (tagIds.length) {
    const current = await tx.select({ tagId: contactTags.tagId }).from(contactTags).where(eq(contactTags.contactId, contactId));
    await replaceTags(tx, ws, 'contact', contactId, [...new Set([...current.map((c) => c.tagId), ...tagIds])]);
  }
}
