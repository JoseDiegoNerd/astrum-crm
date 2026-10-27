import {
  addTenantMember,
  addWorkspaceMember,
  createWorkspace,
  removeWorkspaceMember,
} from "./actions";
import { Button, Card, Input, Notice, Select } from "@/components/ui";
import { api, type TenantMember, type WorkspaceMember } from "@/lib/api";
import { requireWorkspace } from "@/lib/session";

export default async function TeamPage({ searchParams }: PageProps<"/team">) {
  const [{ error }, current] = await Promise.all([searchParams, requireWorkspace()]);
  const { tenant, workspace } = current;
  const isTenantAdmin = tenant.role === "owner" || tenant.role === "admin";

  const [workspaceMembers, tenantMembers] = await Promise.all([
    api<WorkspaceMember[]>("/workspace/members", { workspaceId: workspace.id }),
    api<TenantMember[]>(`/tenants/${tenant.id}/members`),
  ]);
  const candidates = tenantMembers.filter(
    (m) => m.status === "active" && !workspaceMembers.some((w) => w.userId === m.userId),
  );

  return (
    <>
      <main className="mx-auto grid w-full max-w-5xl gap-6 p-6 md:grid-cols-2">
        {typeof error === "string" && (
          <div className="md:col-span-2">
            <Notice tone="error">{error}</Notice>
          </div>
        )}

        <Card title={`Equipe do workspace · ${workspace.name}`}>
          <ul className="mb-4 divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {workspaceMembers.length === 0 && (
              <li className="py-2 text-zinc-500">Só owners e admins da conta têm acesso por enquanto.</li>
            )}
            {workspaceMembers.map((m) => (
              <li key={m.userId} className="flex items-center justify-between py-2">
                <span>
                  {m.name ?? m.email} <span className="text-zinc-500">· {m.role}</span>
                </span>
                <form action={removeWorkspaceMember}>
                  <input type="hidden" name="workspaceId" value={workspace.id} />
                  <input type="hidden" name="userId" value={m.userId} />
                  <button className="text-xs text-red-600 hover:underline">remover</button>
                </form>
              </li>
            ))}
          </ul>
          {candidates.length > 0 && (
            <form action={addWorkspaceMember} className="flex flex-wrap gap-2">
              <input type="hidden" name="workspaceId" value={workspace.id} />
              <Select name="userId" aria-label="Pessoa">
                {candidates.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name ?? m.email}
                  </option>
                ))}
              </Select>
              <Select name="role" defaultValue="agent" aria-label="Papel">
                <option value="manager">manager</option>
                <option value="agent">agent</option>
                <option value="viewer">viewer</option>
              </Select>
              <Button>Adicionar</Button>
            </form>
          )}
        </Card>

        <Card title={`Pessoas da conta · ${tenant.name}`}>
          <ul className="mb-4 divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {tenantMembers.map((m) => (
              <li key={m.userId} className="py-2">
                {m.name ?? m.email}{" "}
                <span className="text-zinc-500">
                  · {m.role}
                  {m.status === "suspended" && " · suspenso"}
                </span>
              </li>
            ))}
          </ul>
          {isTenantAdmin && (
            <form action={addTenantMember} className="flex flex-wrap gap-2">
              <input type="hidden" name="tenantId" value={tenant.id} />
              <div className="min-w-48 flex-1">
                <Input name="email" type="email" required placeholder="e-mail de quem já tem login" />
              </div>
              <Select name="role" defaultValue="member" aria-label="Papel na conta">
                <option value="member">member</option>
                <option value="admin">admin</option>
                {tenant.role === "owner" && <option value="owner">owner</option>}
              </Select>
              <Button>Adicionar</Button>
            </form>
          )}
        </Card>

        {isTenantAdmin && (
          <Card title="Novo workspace">
            <form action={createWorkspace} className="flex gap-2">
              <input type="hidden" name="tenantId" value={tenant.id} />
              <Input name="name" required maxLength={120} placeholder="Ex.: Filial Centro" />
              <Button>Criar</Button>
            </form>
          </Card>
        )}
      </main>
    </>
  );
}
