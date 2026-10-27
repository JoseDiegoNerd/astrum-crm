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
  method?: "GET" | "POST" | "PATCH" | "DELETE";
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
}

export interface CompanySummary {
  id: string;
  name: string;
  document: string | null;
  domain: string | null;
  phone: string | null;
  archivedAt: string | null;
  contactCount: number;
}

export interface Company extends CompanySummary {
  ownerId: string | null;
  contacts: { id: string; name: string; type: ContactType }[];
}
