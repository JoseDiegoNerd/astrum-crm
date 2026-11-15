"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError, type Channel } from "@/lib/api";
import { workspaceApi } from "@/lib/session";

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const messageOf = (error: unknown) => (error instanceof ApiError ? error.message : "Erro inesperado");

/** Resultado que só aparece uma vez na tela (o verify token não é guardado em claro). */
export type WebhookSecretState = {
  error?: string;
  webhook?: { url: string; verifyToken: string };
  channelName?: string;
  status?: Channel["status"];
  lastError?: string | null;
};

export async function connectWhatsApp(_previous: WebhookSecretState, formData: FormData): Promise<WebhookSecretState> {
  try {
    const result = await workspaceApi<{ channel: Channel; webhook: { url: string; verifyToken: string } }>("/channels/whatsapp", {
      method: "POST",
      body: {
        name: field(formData, "name"),
        phoneNumberId: field(formData, "phoneNumberId"),
        wabaId: field(formData, "wabaId"),
        accessToken: field(formData, "accessToken"),
        appSecret: field(formData, "appSecret"),
      },
    });
    revalidatePath("/settings/canais");
    return {
      webhook: result.webhook,
      channelName: result.channel.name,
      status: result.channel.status,
      lastError: result.channel.lastError,
    };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

export async function rotateVerifyToken(_previous: WebhookSecretState, formData: FormData): Promise<WebhookSecretState> {
  try {
    const webhook = await workspaceApi<{ url: string; verifyToken: string }>(`/channels/${field(formData, "id")}/verify-token`, {
      method: "POST",
    });
    return { webhook };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

async function run(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    redirect(`/settings/canais?error=${encodeURIComponent(messageOf(error))}`);
  }
  revalidatePath("/settings/canais");
  revalidatePath("/inbox");
  redirect("/settings/canais");
}

export async function testChannel(formData: FormData) {
  await run(() => workspaceApi(`/channels/${field(formData, "id")}/test`, { method: "POST" }));
}

export async function toggleChannel(formData: FormData) {
  const enable = field(formData, "enable") === "true";
  await run(() => workspaceApi(`/channels/${field(formData, "id")}/${enable ? "enable" : "disable"}`, { method: "POST" }));
}

export async function updateChannel(formData: FormData) {
  // campos vazios = manter o valor atual (segredos nunca vêm preenchidos)
  const body = Object.fromEntries(
    ["name", "phoneNumberId", "wabaId", "accessToken", "appSecret"]
      .map((key) => [key, field(formData, key)])
      .filter(([, value]) => value),
  );
  await run(() => workspaceApi(`/channels/${field(formData, "id")}`, { method: "PATCH", body }));
}

export async function deleteChannel(formData: FormData) {
  await run(() => workspaceApi(`/channels/${field(formData, "id")}`, { method: "DELETE" }));
}
