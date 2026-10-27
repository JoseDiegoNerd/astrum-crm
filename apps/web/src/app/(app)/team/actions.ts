"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { WORKSPACE_COOKIE } from "@/lib/workspace";

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

async function run(action: () => Promise<unknown>, onSuccess = "/team") {
  try {
    await action();
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Erro inesperado";
    redirect(`/team?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/team");
  redirect(onSuccess);
}

export async function createTenant(formData: FormData) {
  try {
    const tenant = await api<{ workspaces: { id: string }[] }>("/tenants", {
      method: "POST",
      body: { name: field(formData, "name"), workspaceName: field(formData, "workspaceName") || undefined },
    });
    const first = tenant.workspaces[0];
    if (first) (await cookies()).set(WORKSPACE_COOKIE, first.id, { path: "/", sameSite: "lax" });
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Erro inesperado";
    redirect(`/onboarding?error=${encodeURIComponent(message)}`);
  }
  redirect("/");
}

export async function selectWorkspace(formData: FormData) {
  (await cookies()).set(WORKSPACE_COOKIE, field(formData, "workspaceId"), { path: "/", sameSite: "lax" });
  redirect("/contacts");
}

export async function createWorkspace(formData: FormData) {
  await run(() =>
    api(`/tenants/${field(formData, "tenantId")}/workspaces`, {
      method: "POST",
      body: { name: field(formData, "name") },
    }),
  );
}

export async function addTenantMember(formData: FormData) {
  await run(() =>
    api(`/tenants/${field(formData, "tenantId")}/members`, {
      method: "POST",
      body: { email: field(formData, "email"), role: field(formData, "role") },
    }),
  );
}

export async function addWorkspaceMember(formData: FormData) {
  await run(() =>
    api("/workspace/members", {
      method: "POST",
      workspaceId: field(formData, "workspaceId"),
      body: { userId: field(formData, "userId"), role: field(formData, "role") },
    }),
  );
}

export async function removeWorkspaceMember(formData: FormData) {
  await run(() =>
    api(`/workspace/members/${field(formData, "userId")}`, {
      method: "DELETE",
      workspaceId: field(formData, "workspaceId"),
    }),
  );
}
