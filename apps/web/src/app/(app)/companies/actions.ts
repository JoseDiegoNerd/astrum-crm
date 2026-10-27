"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError, type Company } from "@/lib/api";
import { workspaceApi } from "@/lib/session";

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

async function run(back: string, action: () => Promise<string | void>) {
  let next: string | void;
  try {
    next = await action();
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Erro inesperado";
    redirect(`${back}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/companies");
  redirect(next ?? back);
}

const companyBody = (formData: FormData) => ({
  name: field(formData, "name"),
  // string vazia = limpar o campo (a API converte para null)
  document: field(formData, "document"),
  domain: field(formData, "domain"),
  phone: field(formData, "phone"),
});

export async function createCompany(formData: FormData) {
  await run("/companies", async () => {
    const company = await workspaceApi<Company>("/companies", { method: "POST", body: companyBody(formData) });
    return `/companies/${company.id}`;
  });
}

export async function updateCompany(formData: FormData) {
  const id = field(formData, "id");
  await run(`/companies/${id}`, async () => {
    await workspaceApi(`/companies/${id}`, { method: "PATCH", body: companyBody(formData) });
  });
}

export async function setCompanyArchived(formData: FormData) {
  const id = field(formData, "id");
  const archive = field(formData, "archive") === "true";
  await run(`/companies/${id}`, async () => {
    await workspaceApi(`/companies/${id}/${archive ? "archive" : "unarchive"}`, { method: "POST" });
  });
}

export async function deleteCompany(formData: FormData) {
  const id = field(formData, "id");
  await run(`/companies/${id}`, async () => {
    await workspaceApi(`/companies/${id}`, { method: "DELETE" });
    return "/companies";
  });
}
