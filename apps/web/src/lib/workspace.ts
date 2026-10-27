import type { MeResponse, Workspace } from "@/lib/api";

export const WORKSPACE_COOKIE = "astrum_workspace";

/** Workspace escolhido (cookie) se o usuário ainda tiver acesso; senão o primeiro disponível. */
export function resolveWorkspace(me: MeResponse, preferredId: string | undefined) {
  const all = me.tenants.flatMap((t) => t.workspaces.map((w) => ({ workspace: w, tenant: t })));
  return all.find((x) => x.workspace.id === preferredId) ?? all[0];
}

export type CurrentWorkspace = NonNullable<ReturnType<typeof resolveWorkspace>>;
export type { Workspace };
