// Espelho tipado das tabelas para consultas via Drizzle.
// A fonte da verdade do schema são as migrations em supabase/migrations/.
import {
  boolean,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const tenantRole = pgEnum('tenant_role', ['owner', 'admin', 'member']);
export const workspaceRole = pgEnum('workspace_role', ['manager', 'agent', 'viewer']);
export const membershipStatus = pgEnum('membership_status', ['active', 'suspended']);
export const tenantStatus = pgEnum('tenant_status', ['active', 'suspended', 'canceled']);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),
  email: text('email'),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  ...timestamps,
});

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: tenantStatus('status').notNull().default('active'),
  settings: jsonb('settings').notNull().default({}),
  ...timestamps,
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    userId: uuid('user_id').notNull().references(() => profiles.id),
    role: tenantRole('role').notNull().default('member'),
    status: membershipStatus('status').notNull().default('active'),
    ...timestamps,
  },
  (t) => [unique().on(t.tenantId, t.userId)],
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    // gerado por trigger quando omitido
    slug: text('slug').notNull().default(''),
    timezone: text('timezone').notNull().default('America/Sao_Paulo'),
    locale: text('locale').notNull().default('pt-BR'),
    settings: jsonb('settings').notNull().default({}),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [unique().on(t.tenantId, t.slug)],
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: workspaceRole('role').notNull().default('agent'),
    ...timestamps,
  },
  (t) => [unique().on(t.workspaceId, t.userId)],
);

// --- F1.1 · CRM: contatos, identidades e empresas -----------------------------

export const contactType = pgEnum('contact_type', ['lead', 'customer', 'other']);
export const lgpdStatus = pgEnum('lgpd_status', ['unknown', 'consented', 'opted_out']);
export const identityChannel = pgEnum('identity_channel', [
  'phone',
  'whatsapp',
  'email',
  'instagram',
  'messenger',
  'telegram',
  'other',
]);

const workspaceScoped = {
  tenantId: uuid('tenant_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  // preenchido pelo banco (auth.uid()); não enviar em insert
  createdBy: uuid('created_by'),
};

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...workspaceScoped,
  name: text('name').notNull(),
  document: text('document'),
  domain: text('domain'),
  phone: text('phone'),
  ownerId: uuid('owner_id'),
  custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  ...timestamps,
});

export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...workspaceScoped,
  name: text('name').notNull(),
  type: contactType('type').notNull().default('lead'),
  companyId: uuid('company_id'),
  ownerId: uuid('owner_id'),
  avatarUrl: text('avatar_url'),
  custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
  lgpdStatus: lgpdStatus('lgpd_status').notNull().default('unknown'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  ...timestamps,
});

export const contactIdentities = pgTable('contact_identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...workspaceScoped,
  contactId: uuid('contact_id').notNull(),
  channel: identityChannel('channel').notNull(),
  identifier: text('identifier').notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
  verified: boolean('verified').notNull().default(false),
  ...timestamps,
});

export type ContactType = (typeof contactType.enumValues)[number];
export type LgpdStatus = (typeof lgpdStatus.enumValues)[number];
export type IdentityChannel = (typeof identityChannel.enumValues)[number];
export type Company = typeof companies.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type ContactIdentity = typeof contactIdentities.$inferSelect;

export type TenantRole = (typeof tenantRole.enumValues)[number];
export type WorkspaceRole = (typeof workspaceRole.enumValues)[number];
export type Tenant = typeof tenants.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
