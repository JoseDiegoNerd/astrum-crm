"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError, type Deal } from "@/lib/api";
import { customPatchFrom } from "@/lib/custom-form";
import { parseMoney } from "@/lib/money";
import { workspaceApi } from "@/lib/session";

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const optional = (formData: FormData, name: string) => field(formData, name) || undefined;

function messageOf(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message === "Valor inválido") return error.message;
  return "Erro inesperado";
}

async function run(back: string, action: () => Promise<string | void>) {
  let next: string | void;
  try {
    next = await action();
  } catch (error) {
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(messageOf(error))}`);
  }
  revalidatePath("/deals");
  redirect(next ?? back);
}

export async function createDeal(formData: FormData) {
  const back = field(formData, "back") || "/deals";
  await run(back, async () => {
    const deal = await workspaceApi<Deal>("/deals", {
      method: "POST",
      body: {
        title: field(formData, "title"),
        pipelineId: optional(formData, "pipelineId"),
        contactId: optional(formData, "contactId"),
        companyId: optional(formData, "companyId"),
        valueCents: parseMoney(field(formData, "value")),
        expectedCloseAt: optional(formData, "expectedCloseAt"),
        custom: customPatchFrom(formData),
      },
    });
    return `/deals/${deal.id}`;
  });
}

export async function updateDeal(formData: FormData) {
  const id = field(formData, "id");
  await run(`/deals/${id}`, async () => {
    await workspaceApi(`/deals/${id}`, {
      method: "PATCH",
      body: {
        title: field(formData, "title"),
        valueCents: parseMoney(field(formData, "value")) ?? 0,
        expectedCloseAt: field(formData, "expectedCloseAt") || null,
        contactId: field(formData, "contactId") || null,
        companyId: field(formData, "companyId") || null,
        ownerId: field(formData, "ownerId") || null,
        ...(formData.has("lostReason") && { lostReason: field(formData, "lostReason") || null }),
        custom: customPatchFrom(formData),
      },
    });
  });
}

/** Mover pelo formulário da ficha (fallback do arrastar e soltar). */
export async function moveDealForm(formData: FormData) {
  const id = field(formData, "id");
  await run(`/deals/${id}`, async () => {
    await workspaceApi(`/deals/${id}/move`, {
      method: "POST",
      body: { stageId: field(formData, "stageId"), lostReason: optional(formData, "lostReason") },
    });
  });
}

/**
 * Chamado pelo kanban ao soltar um card. Não redireciona: devolve o erro
 * (ou null) para o componente desfazer a mudança otimista.
 */
export async function moveDeal(dealId: string, stageId: string, afterDealId: string | null): Promise<string | null> {
  try {
    await workspaceApi(`/deals/${dealId}/move`, { method: "POST", body: { stageId, afterDealId } });
  } catch (error) {
    return messageOf(error);
  }
  revalidatePath("/deals");
  return null;
}

export async function setDealTags(formData: FormData) {
  const id = field(formData, "id");
  await run(`/deals/${id}`, async () => {
    await workspaceApi(`/deals/${id}/tags`, { method: "PUT", body: { tagIds: formData.getAll("tagIds").map(String) } });
  });
}

export async function deleteDeal(formData: FormData) {
  const id = field(formData, "id");
  await run(`/deals/${id}`, async () => {
    await workspaceApi(`/deals/${id}`, { method: "DELETE" });
    return "/deals";
  });
}
