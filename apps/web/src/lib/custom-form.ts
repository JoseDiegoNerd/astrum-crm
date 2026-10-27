import type { CustomFieldDef, CustomFieldType } from "@/lib/api";

/** Campo oculto que diz à server action quais campos customizados o formulário trouxe. */
export const CUSTOM_SCHEMA_FIELD = "__custom_fields";
export const customInputName = (key: string) => `custom.${key}`;

export function customSchemaValue(defs: CustomFieldDef[]) {
  return JSON.stringify(defs.map((d) => ({ key: d.key, type: d.type })));
}

/**
 * Lê os campos customizados de um FormData e monta o patch para a API.
 * Vazio vira null (remove o valor); a validação de tipos e obrigatórios é da API.
 */
export function customPatchFrom(formData: FormData): Record<string, unknown> | undefined {
  const raw = formData.get(CUSTOM_SCHEMA_FIELD);
  if (typeof raw !== "string") return undefined;
  const fields = JSON.parse(raw) as { key: string; type: CustomFieldType }[];
  if (fields.length === 0) return undefined;

  const patch: Record<string, unknown> = {};
  for (const { key, type } of fields) {
    const name = customInputName(key);
    if (type === "multiselect") {
      patch[key] = formData.getAll(name).map(String);
      continue;
    }
    const value = String(formData.get(name) ?? "").trim();
    if (value === "") patch[key] = null;
    else if (type === "boolean") patch[key] = value === "true";
    else patch[key] = value;
  }
  return patch;
}
