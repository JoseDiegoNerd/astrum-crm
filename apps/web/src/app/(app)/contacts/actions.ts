"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError, type Contact } from "@/lib/api";
import { workspaceApi } from "@/lib/session";

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const optional = (formData: FormData, name: string) => field(formData, name) || undefined;

/** Executa a chamada; em erro volta para `back` com a mensagem, em sucesso vai para `next`. */
async function run(back: string, action: () => Promise<string | void>) {
  let next: string | void;
  try {
    next = await action();
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Erro inesperado";
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/contacts");
  redirect(next ?? back);
}

export async function createContact(formData: FormData) {
  const identities = [
    { channel: "whatsapp", identifier: field(formData, "whatsapp") },
    { channel: "email", identifier: field(formData, "email") },
  ].filter((i) => i.identifier);

  await run("/contacts", async () => {
    const contact = await workspaceApi<Contact>("/contacts", {
      method: "POST",
      body: {
        name: field(formData, "name"),
        type: optional(formData, "type"),
        companyId: optional(formData, "companyId"),
        identities,
      },
    });
    return `/contacts/${contact.id}`;
  });
}

export async function updateContact(formData: FormData) {
  const id = field(formData, "id");
  await run(`/contacts/${id}`, async () => {
    await workspaceApi(`/contacts/${id}`, {
      method: "PATCH",
      body: {
        name: field(formData, "name"),
        type: field(formData, "type"),
        companyId: field(formData, "companyId") || null,
        lgpdStatus: field(formData, "lgpdStatus"),
      },
    });
  });
}

export async function addIdentity(formData: FormData) {
  const id = field(formData, "id");
  await run(`/contacts/${id}`, async () => {
    await workspaceApi(`/contacts/${id}/identities`, {
      method: "POST",
      body: { channel: field(formData, "channel"), identifier: field(formData, "identifier") },
    });
  });
}

export async function makePrimaryIdentity(formData: FormData) {
  const id = field(formData, "id");
  await run(`/contacts/${id}`, async () => {
    await workspaceApi(`/contacts/${id}/identities/${field(formData, "identityId")}`, {
      method: "PATCH",
      body: { isPrimary: true },
    });
  });
}

export async function removeIdentity(formData: FormData) {
  const id = field(formData, "id");
  await run(`/contacts/${id}`, async () => {
    await workspaceApi(`/contacts/${id}/identities/${field(formData, "identityId")}`, { method: "DELETE" });
  });
}

export async function setContactArchived(formData: FormData) {
  const id = field(formData, "id");
  const archive = field(formData, "archive") === "true";
  await run(`/contacts/${id}`, async () => {
    await workspaceApi(`/contacts/${id}/${archive ? "archive" : "unarchive"}`, { method: "POST" });
  });
}

export async function deleteContact(formData: FormData) {
  const id = field(formData, "id");
  await run(`/contacts/${id}`, async () => {
    await workspaceApi(`/contacts/${id}`, { method: "DELETE" });
    return "/contacts";
  });
}
