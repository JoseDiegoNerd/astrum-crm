import Link from "next/link";
import { Button, Card, Input, Notice, Select } from "@/components/ui";
import type { Pipeline, StageKind } from "@/lib/api";
import { canDelete, requireWorkspace, workspaceApi } from "@/lib/session";
import {
  addStage,
  createPipeline,
  deletePipeline,
  deleteStage,
  makeDefaultPipeline,
  moveStage,
  renamePipeline,
  updateStage,
} from "./actions";

const KINDS: Record<StageKind, string> = { open: "Em aberto", won: "Ganho", lost: "Perdido" };

export default async function FunnelSettingsPage({ searchParams }: PageProps<"/settings/funil">) {
  const [{ error }, current, pipelines] = await Promise.all([
    searchParams,
    requireWorkspace(),
    workspaceApi<Pipeline[]>("/pipelines"),
  ]);
  const manage = canDelete(current);

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <div>
        <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
          ← Configurações
        </Link>
        <h1 className="text-xl font-semibold">Funil de vendas</h1>
        <p className="text-sm text-zinc-500">
          Etapas &quot;Ganho&quot; e &quot;Perdido&quot; fecham o negócio automaticamente.
          {!manage && " Somente managers alteram o funil."}
        </p>
      </div>
      {typeof error === "string" && <Notice tone="error">{error}</Notice>}

      {pipelines.map((pipeline) => (
        <Card key={pipeline.id} title={pipeline.isDefault ? `${pipeline.name} · padrão` : pipeline.name}>
          {manage && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <form action={renamePipeline} className="flex flex-1 gap-2">
                <input type="hidden" name="id" value={pipeline.id} />
                <Input name="name" defaultValue={pipeline.name} required maxLength={80} aria-label="Nome do pipeline" />
                <Button variant="ghost">Renomear</Button>
              </form>
              {!pipeline.isDefault && (
                <>
                  <form action={makeDefaultPipeline}>
                    <input type="hidden" name="id" value={pipeline.id} />
                    <Button variant="ghost">Tornar padrão</Button>
                  </form>
                  <form action={deletePipeline}>
                    <input type="hidden" name="id" value={pipeline.id} />
                    <button className="text-xs text-red-600 hover:underline">excluir pipeline</button>
                  </form>
                </>
              )}
            </div>
          )}

          <ol className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {pipeline.stages.map((stage, index) => (
              <li key={stage.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="w-6 text-zinc-400">{index + 1}</span>
                {manage ? (
                  <>
                    <form action={updateStage} className="flex flex-1 flex-wrap items-center gap-2">
                      <input type="hidden" name="pipelineId" value={pipeline.id} />
                      <input type="hidden" name="stageId" value={stage.id} />
                      <div className="min-w-36 flex-1">
                        <Input name="name" defaultValue={stage.name} required maxLength={80} aria-label="Nome da etapa" />
                      </div>
                      <Select name="kind" defaultValue={stage.kind} aria-label="Tipo">
                        {Object.entries(KINDS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                      <div className="w-20">
                        <Input
                          name="probability"
                          type="number"
                          min={0}
                          max={100}
                          defaultValue={stage.probability}
                          aria-label="Probabilidade (%)"
                        />
                      </div>
                      <Button variant="ghost">Salvar</Button>
                    </form>
                    <form action={moveStage} className="flex gap-1">
                      <input type="hidden" name="pipelineId" value={pipeline.id} />
                      <input type="hidden" name="stageId" value={stage.id} />
                      <button name="direction" value="up" disabled={index === 0} className="px-1 text-zinc-500 disabled:opacity-30" aria-label="Subir">
                        ↑
                      </button>
                      <button
                        name="direction"
                        value="down"
                        disabled={index === pipeline.stages.length - 1}
                        className="px-1 text-zinc-500 disabled:opacity-30"
                        aria-label="Descer"
                      >
                        ↓
                      </button>
                    </form>
                    <form action={deleteStage}>
                      <input type="hidden" name="pipelineId" value={pipeline.id} />
                      <input type="hidden" name="stageId" value={stage.id} />
                      <button className="text-xs text-red-600 hover:underline">excluir</button>
                    </form>
                  </>
                ) : (
                  <span className="flex-1">
                    {stage.name} <span className="text-xs text-zinc-500">· {KINDS[stage.kind]} · {stage.probability}%</span>
                  </span>
                )}
              </li>
            ))}
          </ol>

          {manage && (
            <form action={addStage} className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
              <input type="hidden" name="pipelineId" value={pipeline.id} />
              <div className="min-w-36 flex-1">
                <Input name="name" required maxLength={80} placeholder="Nova etapa" />
              </div>
              <Select name="kind" defaultValue="open" aria-label="Tipo">
                {Object.entries(KINDS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <div className="w-20">
                <Input name="probability" type="number" min={0} max={100} placeholder="%" aria-label="Probabilidade (%)" />
              </div>
              <Button>Adicionar etapa</Button>
            </form>
          )}
        </Card>
      ))}

      {manage && (
        <Card title="Novo pipeline">
          <form action={createPipeline} className="flex gap-2">
            <Input name="name" required maxLength={80} placeholder="Ex.: Pós-venda, Parcerias" />
            <Button>Criar</Button>
          </form>
          <p className="mt-2 text-xs text-zinc-500">Começa com as etapas Novo, Em andamento, Ganho e Perdido.</p>
        </Card>
      )}
    </main>
  );
}
