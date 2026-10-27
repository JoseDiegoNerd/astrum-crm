// Espelho tipado das tabelas para consultas via Drizzle.
// A fonte da verdade do schema são as migrations em supabase/migrations/.
import {
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

export type TenantRole = (typeof tenantRole.enumValues)[number];
export type WorkspaceRole = (typeof workspaceRole.enumValues)[number];
export type Tenant = typeof tenants.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
