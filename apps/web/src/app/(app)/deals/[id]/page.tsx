import Link from "next/link";
import { Timeline } from "@/components/timeline";
import { NotesCard, TasksCard } from "@/components/work";
import type { Note, Task } from "@/lib/api";
import { getSession } from "@/lib/session";
import { notFound } from "next/navigation";
import { CustomFieldInputs, TagChips } from "@/components/crm";
import { Button, Card, Input, Notice, Select } from "@/components/ui";
import {
  api,
  ApiError,
  type CompanySummary,
  type ContactSummary,
  type CustomFieldDef,
  type Deal,
  type Page,
  type Pipeline,
  type TagSummary,
  type TenantMember,
} from "@/lib/api";
import { centsToInput, formatMoney } from "@/lib/money";
import { canDelete, canEdit, requireWorkspace, workspaceApi } from "@/lib/session";

import { deleteDeal, moveDealForm, setDealTags, updateDeal } from "../actions";

const STATUS = { open: "Em aberto", won: "Ganho", lost: "Perdido" } as const;

export default async function DealPage({ params, searchParams }: PageProps<"/deals/[id]">) {
  const [{ id }, query, current] = await Promise.all([params, searchParams, requireWorkspace()]);
  const deal = await workspaceApi<Deal>(`/deals/${id}`).catch((error) => {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  });
  const [pipelines, contacts, companies, tags, fields, members] = await Promise.all([
    workspaceApi<Pipeline[]>("/pipelines"),
    workspaceApi<Page<ContactSummary>>("/contacts?limit=100"),
    workspaceApi<Page<CompanySummary>>("/companies?limit=100"),
    workspaceApi<TagSummary[]>("/tags"),
    workspaceApi<CustomFieldDef[]>("/custom-fields?entity=deal"),
    api<TenantMember[]>(`/tenants/${current.tenant.id}/members`),
  ]);
  const pipeline = pipelines.find((p) => p.id === deal.pipelineId);
  const [subjectTasks, subjectNotes, { me: sessionMe }] = await Promise.all([
    workspaceApi<Task[]>(`/tasks?assignee=any&status=all&deal=${id}&limit=50`),
    workspaceApi<Note[]>(`/notes?deal=${id}`),
    getSession(),
  ]);
  const editable = canEdit(current);
  const error = typeof query.error === "string" ? query.error : undefined;

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/deals?pipeline=${deal.pipelineId}`} className="text-sm text-zinc-500 hover:underline">
          ← {pipeline?.name ?? "Negócios"}
        </Link>
        <h1 className="text-xl font-semibold">{deal.title}</h1>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            deal.status === "won"
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
              : deal.status === "lost"
                ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                : "bg-zinc-100 dark:bg-zinc-800"
          }`}
        >
          {STATUS[deal.status]} · {deal.stageName}
        </span>
        <TagChips tags={deal.tags} />
        <span className="ml-auto text-lg font-semibold">{formatMoney(deal.valueCents, deal.currency)}</span>
      </div>
      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid gap-6 md:grid-cols-[1fr_280px]">
        <Card title="Dados">
          <form action={updateDeal} className="space-y-3">
            <input type="hidden" name="id" value={deal.id} />
            <fieldset disabled={!editable} className="space-y-3">
              <label className="block space-y-1 text-sm">
                <span>Título</span>
                <Input name="title" defaultValue={deal.title} required maxLength={200} />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1 text-sm">
                  <span>Valor ({deal.currency})</span>
                  <Input name="value" inputMode="decimal" defaultValue={centsToInput(deal.valueCents)} />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>Previsão de fechamento</span>
                  <Input name="expectedCloseAt" type="date" defaultValue={deal.expectedCloseAt ?? ""} />
                </label>
              </div>
              <label className="block space-y-1 text-sm">
                <span>Contato</span>
                <Select name="contactId" defaultValue={deal.contactId ?? ""}>
                  <option value="">Sem contato</option>
                  {contacts.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block space-y-1 text-sm">
                <span>Empresa</span>
                <Select name="companyId" defaultValue={deal.companyId ?? ""}>
                  <option value="">Sem empresa</option>
                  {companies.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block space-y-1 text-sm">
                <span>Responsável</span>
                <Select name="ownerId" defaultValue={deal.ownerId ?? ""}>
                  <option value="">Ninguém</option>
                  {members
                    .filter((m) => m.status === "active")
                    .map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name ?? m.email}
                      </option>
                    ))}
                </Select>
              </label>
              {deal.status === "lost" && (
                <label className="block space-y-1 text-sm">
                  <span>Motivo da perda</span>
                  <Input name="lostReason" defaultValue={deal.lostReason ?? ""} maxLength={500} />
                </label>
              )}
              <CustomFieldInputs defs={fields} values={deal.custom} />
              {editable && <Button>Salvar</Button>}
            </fieldset>
          </form>
        </Card>

        <div className="space-y-6">
          <Card title="Etapa">
            <form action={moveDealForm} className="space-y-3">
              <input type="hidden" name="id" value={deal.id} />
              <fieldset disabled={!editable} className="space-y-3">
                <Select name="stageId" defaultValue={deal.stageId} aria-label="Etapa">
                  {pipeline?.stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                      {stage.kind === "won" ? " ✓" : stage.kind === "lost" ? " ✕" : ""}
                    </option>
                  ))}
                </Select>
                <Input name="lostReason" maxLength={500} placeholder="Motivo (se for para perdido)" />
                {editable && <Button variant="ghost">Mover</Button>}
              </fieldset>
            </form>
            {deal.closedAt && (
              <p className="mt-3 text-xs text-zinc-500">
                Fechado em {new Date(deal.closedAt).toLocaleDateString("pt-BR", { timeZone: current.workspace.timezone })}
              </p>
            )}
          </Card>

          {tags.length > 0 && (
            <Card title="Tags">
              <form action={setDealTags} className="space-y-2 text-sm">
                <input type="hidden" name="id" value={deal.id} />
                <fieldset disabled={!editable} className="flex flex-col gap-1">
                  {tags.map((tag) => (
                    <label key={tag.id} className="inline-flex items-center gap-1">
                      <input type="checkbox" name="tagIds" value={tag.id} defaultChecked={deal.tags.some((t) => t.id === tag.id)} />
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
                      {tag.name}
                    </label>
                  ))}
                </fieldset>
                {editable && <Button variant="ghost">Salvar tags</Button>}
              </form>
            </Card>
          )}

          {canDelete(current) && (
            <form action={deleteDeal} className="flex flex-col gap-2">
              <input type="hidden" name="id" value={deal.id} />
              <label className="flex items-center gap-1 text-xs text-zinc-500">
                <input type="checkbox" required /> excluir este negócio permanentemente
              </label>
              <Button variant="ghost">Excluir</Button>
            </form>
          )}
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <TasksCard
          tasks={subjectTasks}
          subject={{ dealId: id }}
          back={`/deals/${id}`}
          timezone={current.workspace.timezone}
          members={members}
          me={sessionMe.profile?.id}
          editable={editable}
          deletable={canDelete(current)}
        />
        <NotesCard
          notes={subjectNotes}
          subject={{ dealId: id }}
          back={`/deals/${id}`}
          timezone={current.workspace.timezone}
          editable={editable}
          deletable={canDelete(current)}
        />
      </div>
      <Timeline subject={{ dealId: id }} timezone={current.workspace.timezone} />
    </main>
  );
}
