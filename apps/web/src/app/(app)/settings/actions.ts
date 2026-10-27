"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError } from "@/lib/api";
import { workspaceApi } from "@/lib/session";

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
/** "Varejo, Indústria\nServiços" → ["Varejo", "Indústria", "Serviços"] */
const optionsFrom = (formData: FormData) =>
  field(formData, "options")
    .split(/[,\n]/)
    .map((o) => o.trim())
    .filter(Boolean);

async function run(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Erro inesperado";
    redirect(`/settings?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/", "layout");
  redirect("/settings");
}

export async function createTag(formData: FormData) {
  await run(() =>
    workspaceApi("/tags", { method: "POST", body: { name: field(formData, "name"), color: field(formData, "color") } }),
  );
}

export async function updateTag(formData: FormData) {
  await run(() =>
    workspaceApi(`/tags/${field(formData, "id")}`, {
      method: "PATCH",
      body: { name: field(formData, "name"), color: field(formData, "color") },
    }),
  );
}

export async function deleteTag(formData: FormData) {
  await run(() => workspaceApi(`/tags/${field(formData, "id")}`, { method: "DELETE" }));
}

export async function createField(formData: FormData) {
  const type = field(formData, "type");
  await run(() =>
    workspaceApi("/custom-fields", {
      method: "POST",
      body: {
        entity: field(formData, "entity"),
        label: field(formData, "label"),
        type,
        options: type === "select" || type === "multiselect" ? optionsFrom(formData) : [],
        required: formData.get("required") === "on",
      },
    }),
  );
}

export async function updateField(formData: FormData) {
  const hasOptions = formData.has("options");
  await run(() =>
    workspaceApi(`/custom-fields/${field(formData, "id")}`, {
      method: "PATCH",
      body: {
        label: field(formData, "label"),
        required: formData.get("required") === "on",
        ...(hasOptions && { options: optionsFrom(formData) }),
      },
    }),
  );
}

export async function deleteField(formData: FormData) {
  await run(() => workspaceApi(`/custom-fields/${field(formData, "id")}`, { method: "DELETE" }));
}
