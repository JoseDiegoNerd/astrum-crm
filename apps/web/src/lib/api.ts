import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  workspaceId?: string;
}

/** Chama a API do Astrum (somente no servidor) repassando o access token do usuário. */
export async function api<T>(path: string, { method = "GET", body, workspaceId }: ApiOptions = {}) {
  const supabase = await createClient();
  // getSession aqui só serve para obter o token a repassar; a API valida a assinatura.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError(401, "Sessão expirada");

  const response = await fetch(`${env.apiUrl}/v1${path}`, {
    method,
    cache: "no-store",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(workspaceId && { "x-workspace-id": workspaceId }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { message?: unknown };
    const message = typeof error.message === "string" ? error.message : response.statusText;
    throw new ApiError(response.status, message);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

// Contratos da API (espelham apps/api/src/tenancy)
export type TenantRole = "owner" | "admin" | "member";
export type WorkspaceRole = "manager" | "agent" | "viewer";

export interface Workspace {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  timezone: string;
  /** Papel efetivo do usuário (owner/admin do tenant = manager). */
  myRole: WorkspaceRole;
}

export interface MeResponse {
  profile: { id: string; name: string | null; email: string | null } | null;
  tenants: { id: string; name: string; slug: string; role: TenantRole; workspaces: Workspace[] }[];
}

export interface TenantMember {
  userId: string;
  role: TenantRole;
  status: "active" | "suspended";
  name: string | null;
  email: string | null;
}

export interface WorkspaceMember {
  userId: string;
  role: WorkspaceRole;
  name: string | null;
  email: string | null;
}

// --- CRM (espelham apps/api/src/crm) ---

export type ContactType = "lead" | "customer" | "other";
export type LgpdStatus = "unknown" | "consented" | "opted_out";
export type IdentityChannel = "phone" | "whatsapp" | "email" | "instagram" | "messenger" | "telegram" | "other";

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ContactIdentity {
  id: string;
  channel: IdentityChannel;
  identifier: string;
  isPrimary: boolean;
  verified: boolean;
}

export interface ContactSummary {
  id: string;
  name: string;
  type: ContactType;
  companyId: string | null;
  companyName: string | null;
  archivedAt: string | null;
  createdAt: string;
  identities: ContactIdentity[];
  tags: TagSummary[];
}

export interface Contact {
  id: string;
  name: string;
  type: ContactType;
  lgpdStatus: LgpdStatus;
  ownerId: string | null;
  archivedAt: string | null;
  createdAt: string;
  company: { id: string; name: string } | null;
  identities: ContactIdentity[];
  tags: TagSummary[];
  custom: CustomValues;
}

export interface CompanySummary {
  id: string;
  name: string;
  document: string | null;
  domain: string | null;
  phone: string | null;
  archivedAt: string | null;
  contactCount: number;
  tags: TagSummary[];
}

export interface Company extends CompanySummary {
  ownerId: string | null;
  custom: CustomValues;
  contacts: { id: string; name: string; type: ContactType }[];
}

// --- Tags e campos customizados ---

export interface TagSummary {
  id: string;
  name: string;
  color: string;
}

export interface Tag extends TagSummary {
  usage: { contacts: number; companies: number };
}

export type CustomFieldEntity = "contact" | "company" | "deal";
export type CustomFieldType = "text" | "number" | "date" | "boolean" | "select" | "multiselect";

export interface CustomFieldDef {
  id: string;
  entity: CustomFieldEntity;
  key: string;
  label: string;
  type: CustomFieldType;
  options: string[];
  required: boolean;
  position: number;
}

export type CustomValues = Record<string, unknown>;

// --- Funil ---

export type StageKind = "open" | "won" | "lost";
export type DealStatus = StageKind;

export interface PipelineStage {
  id: string;
  pipelineId: string;
  name: string;
  position: number;
  probability: number;
  kind: StageKind;
}

export interface Pipeline {
  id: string;
  name: string;
  isDefault: boolean;
  position: number;
  stages: PipelineStage[];
}

export interface DealSummary {
  id: string;
  title: string;
  pipelineId: string;
  stageId: string;
  stageName: string;
  status: DealStatus;
  valueCents: number;
  currency: string;
  expectedCloseAt: string | null;
  closedAt: string | null;
  lostReason: string | null;
  contactId: string | null;
  contactName: string | null;
  companyId: string | null;
  companyName: string | null;
  ownerId: string | null;
  position: number;
  createdAt: string;
  tags: TagSummary[];
}

export interface Deal extends DealSummary {
  custom: CustomValues;
}

export interface BoardColumn extends PipelineStage {
  count: number;
  totalCents: number;
  deals: DealSummary[];
}

export interface Board {
  pipelines: { id: string; name: string; isDefault: boolean }[];
  pipeline: { id: string; name: string };
  columns: BoardColumn[];
}

// --- Tarefas e notas ---

export type TaskBucket = "overdue" | "today" | "week" | "later" | "none" | "done";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  doneAt: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  contactId: string | null;
  contactName: string | null;
  dealId: string | null;
  dealTitle: string | null;
  companyId: string | null;
  companyName: string | null;
  createdAt: string;
  bucket: TaskBucket;
}

export interface Note {
  id: string;
  body: string;
  contactId: string | null;
  dealId: string | null;
  companyId: string | null;
  authorName: string | null;
  mine: boolean;
  createdAt: string;
  updatedAt: string;
}

// --- Inbox ---

export type ConversationStatus = "open" | "pending" | "resolved";
export type MessageStatus = "received" | "queued" | "sent" | "delivered" | "read" | "failed";

export interface Conversation {
  id: string;
  status: ConversationStatus;
  subject: string | null;
  channelId: string;
  channelName: string;
  channelType: string;
  contactId: string;
  contactName: string;
  assigneeId: string | null;
  assigneeName: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  activityAt: string;
  lastMessage: { body: string | null; type: string; direction: "in" | "out"; status: MessageStatus } | null;
  capabilities: { freeText: boolean; reason?: string };
}

export interface InboxMessage {
  id: string;
  direction: "in" | "out";
  senderType: "contact" | "user" | "system";
  senderName: string | null;
  type: string;
  body: string | null;
  content: Record<string, unknown>;
  status: MessageStatus;
  error: { message?: string; title?: string; code?: number } | null;
  createdAt: string;
}

export interface Channel {
  id: string;
  type: string;
  name: string;
  status: "pending" | "connected" | "error" | "disabled";
  displayIdentifier: string | null;
  lastError: string | null;
}
