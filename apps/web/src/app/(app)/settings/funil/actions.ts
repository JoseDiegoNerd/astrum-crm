"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError, type Pipeline } from "@/lib/api";
import { workspaceApi } from "@/lib/session";

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

async function run(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Erro inesperado";
    redirect(`/settings/funil?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/settings/funil");
  revalidatePath("/deals");
  redirect("/settings/funil");
}

export async function createPipeline(formData: FormData) {
  await run(() => workspaceApi("/pipelines", { method: "POST", body: { name: field(formData, "name") } }));
}

export async function renamePipeline(formData: FormData) {
  await run(() =>
    workspaceApi(`/pipelines/${field(formData, "id")}`, { method: "PATCH", body: { name: field(formData, "name") } }),
  );
}

export async function makeDefaultPipeline(formData: FormData) {
  await run(() => workspaceApi(`/pipelines/${field(formData, "id")}`, { method: "PATCH", body: { isDefault: true } }));
}

export async function deletePipeline(formData: FormData) {
  await run(() => workspaceApi(`/pipelines/${field(formData, "id")}`, { method: "DELETE" }));
}

export async function addStage(formData: FormData) {
  await run(() =>
    workspaceApi(`/pipelines/${field(formData, "pipelineId")}/stages`, {
      method: "POST",
      body: {
        name: field(formData, "name"),
        kind: field(formData, "kind") || "open",
        probability: Number(field(formData, "probability") || 0),
      },
    }),
  );
}

export async function updateStage(formData: FormData) {
  await run(() =>
    workspaceApi(`/pipelines/${field(formData, "pipelineId")}/stages/${field(formData, "stageId")}`, {
      method: "PATCH",
      body: {
        name: field(formData, "name"),
        kind: field(formData, "kind"),
        probability: Number(field(formData, "probability") || 0),
      },
    }),
  );
}

export async function deleteStage(formData: FormData) {
  await run(() =>
    workspaceApi(`/pipelines/${field(formData, "pipelineId")}/stages/${field(formData, "stageId")}`, {
      method: "DELETE",
    }),
  );
}

/** Sobe ou desce uma etapa uma posição. */
export async function moveStage(formData: FormData) {
  const pipelineId = field(formData, "pipelineId");
  const stageId = field(formData, "stageId");
  const delta = field(formData, "direction") === "up" ? -1 : 1;
  await run(async () => {
    const pipelines = await workspaceApi<Pipeline[]>("/pipelines");
    const ids = pipelines.find((p) => p.id === pipelineId)?.stages.map((s) => s.id) ?? [];
    const index = ids.indexOf(stageId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    await workspaceApi(`/pipelines/${pipelineId}/stages/reorder`, { method: "POST", body: { stageIds: ids } });
  });
}
