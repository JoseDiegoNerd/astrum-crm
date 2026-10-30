"use server";

import { revalidatePath } from "next/cache";
import { ApiError } from "@/lib/api";
import { workspaceApi } from "@/lib/session";

export interface ImportReport {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  columns: Record<string, string>;
  ignoredColumns: string[];
  errors: { line: number; message: string }[];
  warnings: string[];
}

export type ImportState = { report?: ImportReport; error?: string; fileName?: string };

const MAX_BYTES = 5 * 1024 * 1024;

/** Lê o arquivo enviado e manda o conteúdo para a API, que valida linha a linha. */
export async function importContacts(_previous: ImportState, formData: FormData): Promise<ImportState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Escolha um arquivo .csv" };
  if (file.size > MAX_BYTES) return { error: "Arquivo maior que 5 MB. Divida em partes menores." };

  const buffer = Buffer.from(await file.arrayBuffer());
  // Excel antigo salva em Windows-1252; se não for UTF-8 válido, decodifica assim
  let csv = new TextDecoder("utf-8").decode(buffer);
  if (csv.includes("�")) csv = new TextDecoder("windows-1252").decode(buffer);

  try {
    const report = await workspaceApi<ImportReport>("/contacts/import", {
      method: "POST",
      body: { csv, mode: formData.get("mode") === "merge" ? "merge" : "skip" },
    });
    revalidatePath("/contacts");
    return { report, fileName: file.name };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "Erro inesperado", fileName: file.name };
  }
}
