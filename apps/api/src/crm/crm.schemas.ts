import {
  contactType,
  customFieldEntity,
  customFieldType,
  dealStatus,
  identityChannel,
  lgpdStatus,
  stageKind,
} from '@astrum/db';
import { z } from 'zod';
import { normalizeCnpj } from './cnpj.js';
import { InvalidIdentityError, normalizeIdentity, normalizePhone } from './identity.js';

const name = z.string().trim().min(1).max(200);
const optionalUuid = z.uuid().nullable().optional();
// valores validados depois contra custom_field_defs do workspace (custom-fields.ts)
const custom = z.record(z.string(), z.unknown()).optional();

export const identityInputSchema = z
  .object({
    channel: z.enum(identityChannel.enumValues),
    identifier: z.string().min(1).max(320),
    isPrimary: z.boolean().optional(),
  })
  .transform((value, ctx) => {
    try {
      return { ...value, identifier: normalizeIdentity(value.channel, value.identifier) };
    } catch (error) {
      if (!(error instanceof InvalidIdentityError)) throw error;
      ctx.addIssue({ code: 'custom', path: ['identifier'], message: error.message });
      return z.NEVER;
    }
  });

export const createContactSchema = z.object({
  name,
  type: z.enum(contactType.enumValues).optional(),
  companyId: optionalUuid,
  ownerId: optionalUuid,
  lgpdStatus: z.enum(lgpdStatus.enumValues).optional(),
  custom,
  identities: z.array(identityInputSchema).max(20).default([]),
});

export const updateContactSchema = z
  .object({
    name: name.optional(),
    type: z.enum(contactType.enumValues).optional(),
    companyId: optionalUuid,
    ownerId: optionalUuid,
    lgpdStatus: z.enum(lgpdStatus.enumValues).optional(),
    custom,
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nada para alterar');

export const updateIdentitySchema = z.object({ isPrimary: z.literal(true) });

const listBase = {
  q: z.string().trim().max(100).optional(),
  tag: z.uuid().optional(),
  archived: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
};

export const listContactsSchema = z.object({
  ...listBase,
  type: z.enum(contactType.enumValues).optional(),
  companyId: z.uuid().optional(),
});

export const listCompaniesSchema = z.object(listBase);

const cnpj = z
  .string()
  .transform((value, ctx) => {
    if (value.trim() === '') return null;
    const normalized = normalizeCnpj(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'CNPJ inválido' });
      return z.NEVER;
    }
    return normalized;
  })
  .nullable()
  .optional();

const domain = z
  .string()
  .transform((value) =>
    value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') || null,
  )
  .pipe(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Domínio inválido').nullable())
  .nullable()
  .optional();

const phone = z
  .string()
  .transform((value, ctx) => {
    if (value.trim() === '') return null;
    try {
      return normalizePhone(value);
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: (error as Error).message });
      return z.NEVER;
    }
  })
  .nullable()
  .optional();

export const createCompanySchema = z.object({
  name,
  document: cnpj,
  domain,
  phone,
  ownerId: optionalUuid,
  custom,
});

export const updateCompanySchema = createCompanySchema
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nada para alterar');

// --- Tags e campos customizados (configuração do workspace) ---

const hexColor = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, 'Cor no formato #rrggbb');

export const createTagSchema = z.object({ name: z.string().trim().min(1).max(50), color: hexColor.optional() });
export const updateTagSchema = createTagSchema
  .partial()
  .refine((v) => v.name !== undefined || v.color !== undefined, 'Nada para alterar');
export const setTagsSchema = z.object({ tagIds: z.array(z.uuid()).max(50).transform((ids) => [...new Set(ids)]) });

const fieldOptions = z
  .array(z.string().trim().min(1).max(100))
  .max(100)
  .transform((options) => [...new Set(options)]);
const withOptions = new Set(['select', 'multiselect']);

export const createFieldSchema = z
  .object({
    entity: z.enum(customFieldEntity.enumValues),
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use letras minúsculas, números e _').optional(),
    label: z.string().trim().min(1).max(80),
    type: z.enum(customFieldType.enumValues),
    options: fieldOptions.default([]),
    required: z.boolean().default(false),
    position: z.number().int().min(0).max(1000).default(0),
  })
  .refine((v) => (withOptions.has(v.type) ? v.options.length > 0 : v.options.length === 0), {
    path: ['options'],
    message: 'Seleção exige opções; os demais tipos não usam opções',
  });

export const updateFieldSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    options: fieldOptions.optional(),
    required: z.boolean().optional(),
    position: z.number().int().min(0).max(1000).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nada para alterar');

export const listFieldsSchema = z.object({ entity: z.enum(customFieldEntity.enumValues).optional() });

// --- Funil: pipelines, etapas e negócios ---

const stageName = z.string().trim().min(1).max(80);
const stageInput = z.object({
  name: stageName,
  kind: z.enum(stageKind.enumValues).default('open'),
  probability: z.number().int().min(0).max(100).default(0),
});

export const createPipelineSchema = z.object({
  name: z.string().trim().min(1).max(80),
  stages: z.array(stageInput).min(1).max(30).optional(),
});
export const updatePipelineSchema = z
  .object({ name: z.string().trim().min(1).max(80).optional(), isDefault: z.literal(true).optional() })
  .refine((v) => v.name !== undefined || v.isDefault !== undefined, 'Nada para alterar');
export const createStageSchema = stageInput;
export const updateStageSchema = z
  .object({
    name: stageName.optional(),
    kind: z.enum(stageKind.enumValues).optional(),
    probability: z.number().int().min(0).max(100).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nada para alterar');
export const reorderStagesSchema = z.object({ stageIds: z.array(z.uuid()).min(1).max(30) });

const valueCents = z.number().int().min(0).max(100_000_000_000_000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');

export const createDealSchema = z.object({
  title: z.string().trim().min(1).max(200),
  pipelineId: z.uuid().optional(),
  stageId: z.uuid().optional(),
  contactId: optionalUuid,
  companyId: optionalUuid,
  ownerId: optionalUuid,
  valueCents: valueCents.optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  expectedCloseAt: isoDate.nullable().optional(),
  custom,
});

export const updateDealSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    contactId: optionalUuid,
    companyId: optionalUuid,
    ownerId: optionalUuid,
    valueCents: valueCents.optional(),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
    expectedCloseAt: isoDate.nullable().optional(),
    lostReason: z.string().trim().max(500).nullable().optional(),
    custom,
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nada para alterar');

export const moveDealSchema = z.object({
  stageId: z.uuid(),
  /** Negócio que fica logo acima na coluna; null/ausente = topo da coluna. */
  afterDealId: z.uuid().nullable().optional(),
  lostReason: z.string().trim().max(500).optional(),
});

export const listDealsSchema = z.object({
  q: z.string().trim().max(100).optional(),
  pipeline: z.uuid().optional(),
  stage: z.uuid().optional(),
  status: z.enum(dealStatus.enumValues).optional(),
  owner: z.uuid().optional(),
  contact: z.uuid().optional(),
  company: z.uuid().optional(),
  tag: z.uuid().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const boardSchema = z.object({ pipeline: z.uuid().optional(), owner: z.uuid().optional() });

// --- Tarefas e notas ---

/**
 * Prazo: ISO com fuso ("2026-10-30T17:00:00Z") ou horário local do workspace
 * ("2026-10-30T14:00", como vem de <input type="datetime-local">).
 */
const dueAt = z
  .union([z.iso.datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/)])
  .nullable()
  .optional();

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  dueAt,
  /** Padrão: quem cria. */
  assigneeId: optionalUuid,
  contactId: optionalUuid,
  dealId: optionalUuid,
  companyId: optionalUuid,
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    dueAt,
    assigneeId: optionalUuid,
    contactId: optionalUuid,
    dealId: optionalUuid,
    companyId: optionalUuid,
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nada para alterar');

export const listTasksSchema = z.object({
  /** "me" (padrão), "any" ou o id de um membro. */
  assignee: z.union([z.literal('me'), z.literal('any'), z.uuid()]).default('me'),
  status: z.enum(['open', 'done', 'all']).default('open'),
  contact: z.uuid().optional(),
  deal: z.uuid().optional(),
  company: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const createNoteSchema = z
  .object({
    body: z.string().trim().min(1).max(10000),
    contactId: z.uuid().optional(),
    dealId: z.uuid().optional(),
    companyId: z.uuid().optional(),
  })
  .refine((v) => v.contactId || v.dealId || v.companyId, 'Informe o contato, negócio ou empresa da nota');

export const updateNoteSchema = z.object({ body: z.string().trim().min(1).max(10000) });

export const listNotesSchema = z
  .object({
    contact: z.uuid().optional(),
    deal: z.uuid().optional(),
    company: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .refine((v) => v.contact || v.deal || v.company, 'Filtre por contato, negócio ou empresa');

export const timelineSchema = z
  .object({
    contact: z.uuid().optional(),
    deal: z.uuid().optional(),
    company: z.uuid().optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((v) => v.contact || v.deal || v.company, 'Filtre por contato, negócio ou empresa');

export type TimelineInput = z.infer<typeof timelineSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTasksInput = z.infer<typeof listTasksSchema>;
export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
export type ListNotesInput = z.infer<typeof listNotesSchema>;

export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;
export type UpdatePipelineInput = z.infer<typeof updatePipelineSchema>;
export type CreateStageInput = z.infer<typeof createStageSchema>;
export type UpdateStageInput = z.infer<typeof updateStageSchema>;
export type ReorderStagesInput = z.infer<typeof reorderStagesSchema>;
export type CreateDealInput = z.infer<typeof createDealSchema>;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;
export type MoveDealInput = z.infer<typeof moveDealSchema>;
export type ListDealsInput = z.infer<typeof listDealsSchema>;
export type BoardInput = z.infer<typeof boardSchema>;

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
export type SetTagsInput = z.infer<typeof setTagsSchema>;
export type CreateFieldInput = z.infer<typeof createFieldSchema>;
export type UpdateFieldInput = z.infer<typeof updateFieldSchema>;
export type ListFieldsInput = z.infer<typeof listFieldsSchema>;

export type IdentityInput = z.infer<typeof identityInputSchema>;
export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type ListContactsInput = z.infer<typeof listContactsSchema>;
export type ListCompaniesInput = z.infer<typeof listCompaniesSchema>;
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
