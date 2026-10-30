"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError } from "@/lib/api";
import { workspaceApi } from "@/lib/session";

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const optional = (formData: FormData, name: string) => field(formData, name) || undefined;

/** Todas as ações voltam para a página de origem (campo oculto "back"). */
async function run(formData: FormData, action: () => Promise<unknown>) {
  const back = field(formData, "back") || "/tasks";
  try {
    await action();
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Erro inesperado";
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
  }
  revalidatePath(back.split("?")[0]!);
  revalidatePath("/tasks");
  redirect(back);
}

// --- Tarefas ---

export async function createTask(formData: FormData) {
  await run(formData, () =>
    workspaceApi("/tasks", {
      method: "POST",
      body: {
        title: field(formData, "title"),
        description: optional(formData, "description"),
        // datetime-local: horário do workspace; a API converte
        dueAt: optional(formData, "dueAt"),
        assigneeId: optional(formData, "assigneeId"),
        contactId: optional(formData, "contactId"),
        dealId: optional(formData, "dealId"),
        companyId: optional(formData, "companyId"),
      },
    }),
  );
}

export async function updateTask(formData: FormData) {
  await run(formData, () =>
    workspaceApi(`/tasks/${field(formData, "id")}`, {
      method: "PATCH",
      body: {
        title: field(formData, "title"),
        dueAt: field(formData, "dueAt") || null,
        assigneeId: field(formData, "assigneeId") || null,
      },
    }),
  );
}

export async function toggleTask(formData: FormData) {
  const done = field(formData, "done") === "true";
  await run(formData, () =>
    workspaceApi(`/tasks/${field(formData, "id")}/${done ? "complete" : "reopen"}`, { method: "POST" }),
  );
}

export async function deleteTask(formData: FormData) {
  await run(formData, () => workspaceApi(`/tasks/${field(formData, "id")}`, { method: "DELETE" }));
}

// --- Notas ---

export async function createNote(formData: FormData) {
  await run(formData, () =>
    workspaceApi("/notes", {
      method: "POST",
      body: {
        body: field(formData, "body"),
        contactId: optional(formData, "contactId"),
        dealId: optional(formData, "dealId"),
        companyId: optional(formData, "companyId"),
      },
    }),
  );
}

export async function updateNote(formData: FormData) {
  await run(formData, () =>
    workspaceApi(`/notes/${field(formData, "id")}`, { method: "PATCH", body: { body: field(formData, "body") } }),
  );
}

export async function deleteNote(formData: FormData) {
  await run(formData, () => workspaceApi(`/notes/${field(formData, "id")}`, { method: "DELETE" }));
}
