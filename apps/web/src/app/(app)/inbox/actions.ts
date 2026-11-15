"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError } from "@/lib/api";
import { workspaceApi } from "@/lib/session";

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

export type SendState = { error?: string; sentAt?: number };

/** Envio pelo composer (texto ou template). Devolve erro para o formulário, sem sair da tela. */
export async function sendMessage(_previous: SendState, formData: FormData): Promise<SendState> {
  const conversationId = field(formData, "conversationId");
  const kind = field(formData, "kind");
  const body =
    kind === "template"
      ? {
          type: "template",
          template: {
            name: field(formData, "templateName"),
            language: field(formData, "templateLanguage") || "pt_BR",
            parameters: field(formData, "templateParameters")
              .split("|")
              .map((p) => p.trim())
              .filter(Boolean),
          },
        }
      : { type: "text", body: field(formData, "body") };

  try {
    await workspaceApi(`/conversations/${conversationId}/messages`, { method: "POST", body });
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "Erro inesperado ao enviar" };
  }
  revalidatePath("/inbox");
  return { sentAt: Date.now() };
}

/** Status e responsável da conversa (botões do cabeçalho). */
export async function updateConversation(formData: FormData) {
  const id = field(formData, "id");
  const back = field(formData, "back") || `/inbox?c=${id}`;
  const body: Record<string, unknown> = {};
  if (formData.has("status")) body.status = field(formData, "status");
  if (formData.has("assigneeId")) body.assigneeId = field(formData, "assigneeId") || null;
  try {
    await workspaceApi(`/conversations/${id}`, { method: "PATCH", body });
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Erro inesperado";
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/inbox");
  redirect(back);
}

/** Chamado pela tela ao abrir uma conversa com mensagens não lidas. */
export async function markConversationRead(conversationId: string) {
  try {
    await workspaceApi(`/conversations/${conversationId}/read`, { method: "POST" });
    revalidatePath("/inbox");
  } catch {
    // marcar como lida é conveniência: falha não deve atrapalhar o atendimento
  }
}
