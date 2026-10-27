import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { api, type MeResponse } from "@/lib/api";
import { resolveWorkspace, WORKSPACE_COOKIE, type CurrentWorkspace } from "@/lib/workspace";

/** Usuário, contas e workspace atual — buscado uma vez por requisição. */
export const getSession = cache(async () => {
  const [me, cookieStore] = await Promise.all([api<MeResponse>("/me"), cookies()]);
  return { me, current: resolveWorkspace(me, cookieStore.get(WORKSPACE_COOKIE)?.value) };
});

/** Workspace atual; manda para o onboarding quem ainda não tem conta. */
export async function requireWorkspace(): Promise<CurrentWorkspace> {
  const { me, current } = await getSession();
  if (me.tenants.length === 0) redirect("/onboarding");
  if (!current) redirect("/sem-workspace");
  return current;
}

type ApiOptions = NonNullable<Parameters<typeof api>[1]>;

/** Chamada à API no workspace atual (header X-Workspace-Id). */
export async function workspaceApi<T>(path: string, options: Omit<ApiOptions, "workspaceId"> = {}) {
  const { workspace } = await requireWorkspace();
  return api<T>(path, { ...options, workspaceId: workspace.id });
}

export function canEdit(current: CurrentWorkspace) {
  return current.workspace.myRole !== "viewer";
}

export function canDelete(current: CurrentWorkspace) {
  return current.workspace.myRole === "manager";
}
