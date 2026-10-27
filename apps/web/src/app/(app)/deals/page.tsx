import Link from "next/link";
import { CustomFieldInputs } from "@/components/crm";
import { Button, Card, Input, Notice, Select } from "@/components/ui";
import type { Board, CompanySummary, ContactSummary, CustomFieldDef, Page } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { canEdit, getSession, requireWorkspace, workspaceApi } from "@/lib/session";
import { createDeal } from "./actions";
import { Kanban } from "./kanban";

export default async function DealsPage({ searchParams }: PageProps<"/deals">) {
  const params = await searchParams;
  const str = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);
  const pipelineId = str("pipeline");
  const mine = str("mine") === "1";

  const [current, { me }] = await Promise.all([requireWorkspace(), getSession()]);
  const query = new URLSearchParams();
  if (pipelineId) query.set("pipeline", pipelineId);
  if (mine && me.profile) query.set("owner", me.profile.id);

  const [board, contacts, companies, fields] = await Promise.all([
    workspaceApi<Board>(`/deals/board?${query}`),
    workspaceApi<Page<ContactSummary>>("/contacts?limit=100"),
    workspaceApi<Page<CompanySummary>>("/companies?limit=100"),
    workspaceApi<CustomFieldDef[]>("/custom-fields?entity=deal"),
  ]);
  const { columns } = board;
  const openTotal = columns.filter((c) => c.kind === "open").reduce((sum, c) => sum + c.totalCents, 0);
  const editable = canEdit(current);

  return (
    <main className="w-full space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Negócios</h1>
        <form className="flex items-center gap-2">
          <Select name="pipeline" defaultValue={board.pipeline.id} aria-label="Pipeline">
            {board.pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isDefault ? " (padrão)" : ""}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" name="mine" value="1" defaultChecked={mine} /> só os meus
          </label>
          <Button variant="ghost">Ver</Button>
        </form>
        <span className="ml-auto text-sm text-zinc-500">
          Em aberto: <strong className="text-zinc-900 dark:text-zinc-100">{formatMoney(openTotal)}</strong>
        </span>
        {current.workspace.myRole === "manager" && (
          <Link href="/settings/funil" className="text-sm text-indigo-600 hover:underline">
            Configurar funil
          </Link>
        )}
      </div>
      {str("error") && <Notice tone="error">{str("error")}</Notice>}

      <Kanban columns={columns} canMove={editable} />

      {editable && (
        <div className="max-w-xl">
          <Card title="Novo negócio">
            <form action={createDeal} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="pipelineId" value={board.pipeline.id} />
              <input type="hidden" name="back" value={`/deals?${query}`} />
              <div className="sm:col-span-2">
                <Input name="title" required maxLength={200} placeholder="Título (ex.: Plano anual — Padaria Sol)" />
              </div>
              <Input name="value" inputMode="decimal" placeholder="Valor (R$)" />
              <Input name="expectedCloseAt" type="date" aria-label="Previsão de fechamento" />
              <Select name="contactId" defaultValue={str("contact") ?? ""} aria-label="Contato">
                <option value="">Sem contato</option>
                {contacts.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Select name="companyId" defaultValue={str("company") ?? ""} aria-label="Empresa">
                <option value="">Sem empresa</option>
                {companies.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <CustomFieldInputs defs={fields.filter((f) => f.required)} />
              <div>
                <Button>Criar negócio</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </main>
  );
}
