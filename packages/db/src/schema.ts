// Espelho tipado das tabelas para consultas via Drizzle.
// A fonte da verdade do schema são as migrations em supabase/migrations/.
import {
  bigint,
  boolean,
  char,
  customType,
  date,
  doublePrecision,
  integer,
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

// --- F1.2 · Tags e campos customizados ------------------------------------------

export const customFieldEntity = pgEnum('custom_field_entity', ['contact', 'company', 'deal']);
export const customFieldType = pgEnum('custom_field_type', [
  'text',
  'number',
  'date',
  'boolean',
  'select',
  'multiselect',
]);

export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...workspaceScoped,
  name: text('name').notNull(),
  color: text('color').notNull().default('#6366f1'),
  ...timestamps,
});

export const contactTags = pgTable('contact_tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...workspaceScoped,
  contactId: uuid('contact_id').notNull(),
  tagId: uuid('tag_id').notNull(),
  ...timestamps,
});

export const companyTags = pgTable('company_tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...workspaceScoped,
  companyId: uuid('company_id').notNull(),
  tagId: uuid('tag_id').notNull(),
  ...timestamps,
});

export const customFieldDefs = pgTable('custom_field_defs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...workspaceScoped,
  entity: customFieldEntity('entity').notNull(),
  key: text('key').notNull(),
  label: text('label').notNull(),
  type: customFieldType('type').notNull(),
  options: jsonb('options').$type<string[]>().notNull().default([]),
  required: boolean('required').notNull().default(false),
  position: integer('position').notNull().default(0),
  ...timestamps,
});

// --- F1.3 · Funil: pipelines, etapas e negócios ---------------------------------

export const stageKind = pgEnum('stage_kind', ['open', 'won', 'lost']);
export const dealStatus = pgEnum('deal_status', ['open', 'won', 'lost']);

export const pipelines = pgTable('pipelines', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...workspaceScoped,
  name: text('name').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  position: integer('position').notNull().default(0),
  ...timestamps,
});

export const pipelineStages = pgTable('pipeline_stages', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...workspaceScoped,
  pipelineId: uuid('pipeline_id').notNull(),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0),
  probability: integer('probability').notNull().default(0),
  kind: stageKind('kind').notNull().default('open'),
  ...timestamps,
});

export const deals = pgTable('deals', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...workspaceScoped,
  title: text('title').notNull(),
  pipelineId: uuid('pipeline_id').notNull(),
  stageId: uuid('stage_id').notNull(),
  contactId: uuid('contact_id'),
  companyId: uuid('company_id'),
  ownerId: uuid('owner_id'),
  valueCents: bigint('value_cents', { mode: 'number' }).notNull().default(0),
  currency: char('currency', { length: 3 }).notNull().default('BRL'),
  expectedCloseAt: date('expected_close_at'),
  // derivados da etapa pelo banco; não enviar em insert/update
  status: dealStatus('status').notNull().default('open'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  lostReason: text('lost_reason'),
  position: doublePrecision('position').notNull().default(0),
  custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export const dealTags = pgTable('deal_tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...workspaceScoped,
  dealId: uuid('deal_id').notNull(),
  tagId: uuid('tag_id').notNull(),
  ...timestamps,
});

// --- F1.4 · Tarefas e notas -----------------------------------------------------

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...workspaceScoped,
  title: text('title').notNull(),
  description: text('description'),
  dueAt: timestamp('due_at', { withTimezone: true }),
  assigneeId: uuid('assignee_id'),
  contactId: uuid('contact_id'),
  dealId: uuid('deal_id'),
  companyId: uuid('company_id'),
  doneAt: timestamp('done_at', { withTimezone: true }),
  ...timestamps,
});

export const notes = pgTable('notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...workspaceScoped,
  body: text('body').notNull(),
  contactId: uuid('contact_id'),
  dealId: uuid('deal_id'),
  companyId: uuid('company_id'),
  ...timestamps,
});

// --- F2.1 · Inbox: canais, conversas, mensagens --------------------------------

export const channelType = pgEnum('channel_type', ['whatsapp', 'email', 'instagram', 'messenger', 'telegram', 'webchat']);
export const channelStatus = pgEnum('channel_status', ['pending', 'connected', 'error', 'disabled']);
export const conversationStatus = pgEnum('conversation_status', ['open', 'pending', 'resolved']);
export const messageDirection = pgEnum('message_direction', ['in', 'out']);
export const messageSender = pgEnum('message_sender', ['contact', 'user', 'system']);
export const messageType = pgEnum('message_type', [
  'text',
  'image',
  'audio',
  'video',
  'document',
  'sticker',
  'location',
  'template',
  'interactive',
  'unsupported',
]);
export const messageStatus = pgEnum('message_status', ['received', 'queued', 'sent', 'delivered', 'read', 'failed']);
export const inboundEventStatus = pgEnum('inbound_event_status', ['pending', 'processed', 'failed', 'ignored']);

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => 'bytea',
  fromDriver: (value) => (Buffer.isBuffer(value) ? value : Buffer.from(value)),
});

export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...workspaceScoped,
  type: channelType('type').notNull(),
  name: text('name').notNull(),
  status: channelStatus('status').notNull().default('pending'),
  externalAccountId: text('external_account_id'),
  externalId: text('external_id'),
  displayIdentifier: text('display_identifier'),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  // ⚠ segredos: usuários não têm SELECT nessas colunas — selecione colunas
  // explícitas (channelPublicColumns) em consultas feitas como usuário
  credentialsEnc: bytea('credentials_enc'),
  webhookSecretHash: text('webhook_secret_hash'),
  lastError: text('last_error'),
  connectedAt: timestamp('connected_at', { withTimezone: true }),
  ...timestamps,
});

/** Colunas de channels legíveis por usuários (sem segredos). */
export const channelPublicColumns = {
  id: channels.id,
  tenantId: channels.tenantId,
  workspaceId: channels.workspaceId,
  type: channels.type,
  name: channels.name,
  status: channels.status,
  externalAccountId: channels.externalAccountId,
  externalId: channels.externalId,
  displayIdentifier: channels.displayIdentifier,
  config: channels.config,
  lastError: channels.lastError,
  connectedAt: channels.connectedAt,
  createdAt: channels.createdAt,
  updatedAt: channels.updatedAt,
};

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...workspaceScoped,
  channelId: uuid('channel_id').notNull(),
  contactId: uuid('contact_id').notNull(),
  identityId: uuid('identity_id'),
  status: conversationStatus('status').notNull().default('open'),
  assigneeId: uuid('assignee_id'),
  subject: text('subject'),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
  lastOutboundAt: timestamp('last_outbound_at', { withTimezone: true }),
  unreadCount: integer('unread_count').notNull().default(0),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  ...timestamps,
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  conversationId: uuid('conversation_id').notNull(),
  channelId: uuid('channel_id').notNull(),
  direction: messageDirection('direction').notNull(),
  senderType: messageSender('sender_type').notNull(),
  // preenchido pelo banco (auth.uid()) nas mensagens de usuários
  senderId: uuid('sender_id'),
  type: messageType('type').notNull().default('text'),
  body: text('body'),
  content: jsonb('content').$type<Record<string, unknown>>().notNull().default({}),
  externalId: text('external_id'),
  replyToId: uuid('reply_to_id'),
  status: messageStatus('status').notNull().default('queued'),
  error: jsonb('error').$type<Record<string, unknown>>(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true }),
  ...timestamps,
});

export const inboundEvents = pgTable('inbound_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  channelId: uuid('channel_id').notNull(),
  externalId: text('external_id').notNull(),
  payload: jsonb('payload').$type<unknown>().notNull(),
  status: inboundEventStatus('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Channel = typeof channels.$inferSelect;
export type ChannelType = (typeof channelType.enumValues)[number];
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MessageType = (typeof messageType.enumValues)[number];
export type MessageStatus = (typeof messageStatus.enumValues)[number];

// --- F1.5 · Linha do tempo (somente leitura; escrita por triggers) ---------------

export const activityTypes = [
  'contact.created',
  'company.created',
  'deal.created',
  'deal.stage_changed',
  'deal.won',
  'deal.lost',
  'task.created',
  'task.completed',
  'note.added',
  'conversation.opened',
  'conversation.resolved',
] as const;
export type ActivityType = (typeof activityTypes)[number];

export const activities = pgTable('activities', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  type: text('type').$type<ActivityType>().notNull(),
  contactId: uuid('contact_id'),
  dealId: uuid('deal_id'),
  companyId: uuid('company_id'),
  conversationId: uuid('conversation_id'),
  actorId: uuid('actor_id'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Activity = typeof activities.$inferSelect;

export type Task = typeof tasks.$inferSelect;
export type Note = typeof notes.$inferSelect;

export type Pipeline = typeof pipelines.$inferSelect;
export type PipelineStage = typeof pipelineStages.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type StageKind = (typeof stageKind.enumValues)[number];
export type DealStatus = (typeof dealStatus.enumValues)[number];

export type Tag = typeof tags.$inferSelect;
export type CustomFieldDef = typeof customFieldDefs.$inferSelect;
export type CustomFieldEntity = (typeof customFieldEntity.enumValues)[number];
export type CustomFieldType = (typeof customFieldType.enumValues)[number];

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
