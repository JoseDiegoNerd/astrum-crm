import { contactType, identityChannel, lgpdStatus } from '@astrum/db';
import { z } from 'zod';
import { normalizeCnpj } from './cnpj.js';
import { InvalidIdentityError, normalizeIdentity, normalizePhone } from './identity.js';

const name = z.string().trim().min(1).max(200);
const optionalUuid = z.uuid().nullable().optional();

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
  identities: z.array(identityInputSchema).max(20).default([]),
});

export const updateContactSchema = z
  .object({
    name: name.optional(),
    type: z.enum(contactType.enumValues).optional(),
    companyId: optionalUuid,
    ownerId: optionalUuid,
    lgpdStatus: z.enum(lgpdStatus.enumValues).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nada para alterar');

export const updateIdentitySchema = z.object({ isPrimary: z.literal(true) });

const listBase = {
  q: z.string().trim().max(100).optional(),
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
});

export const updateCompanySchema = createCompanySchema
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nada para alterar');

export type IdentityInput = z.infer<typeof identityInputSchema>;
export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type ListContactsInput = z.infer<typeof listContactsSchema>;
export type ListCompaniesInput = z.infer<typeof listCompaniesSchema>;
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
