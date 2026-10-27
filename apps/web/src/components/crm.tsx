import { Input, Select } from "@/components/ui";
import type { CustomFieldDef, CustomValues, TagSummary } from "@/lib/api";
import { CUSTOM_SCHEMA_FIELD, customInputName, customSchemaValue } from "@/lib/custom-form";

export function TagChips({ tags }: { tags: TagSummary[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
          style={{ backgroundColor: tag.color }}
        >
          {tag.name}
        </span>
      ))}
    </span>
  );
}

/** Inputs dos campos customizados, um por definição, conforme o tipo. */
export function CustomFieldInputs({ defs, values = {} }: { defs: CustomFieldDef[]; values?: CustomValues }) {
  if (defs.length === 0) return null;
  return (
    <>
      <input type="hidden" name={CUSTOM_SCHEMA_FIELD} value={customSchemaValue(defs)} />
      {defs.map((def) => (
        <label key={def.id} className="block space-y-1 text-sm">
          <span>
            {def.label}
            {def.required && <span className="text-red-600"> *</span>}
          </span>
          <CustomFieldInput def={def} value={values[def.key]} />
        </label>
      ))}
    </>
  );
}

function CustomFieldInput({ def, value }: { def: CustomFieldDef; value: unknown }) {
  const name = customInputName(def.key);
  const text = value === undefined || value === null ? "" : String(value);
  switch (def.type) {
    case "number":
      return <Input name={name} type="number" step="any" defaultValue={text} required={def.required} />;
    case "date":
      return <Input name={name} type="date" defaultValue={text} required={def.required} />;
    case "boolean":
      return (
        <Select name={name} defaultValue={value === undefined || value === null ? "" : String(value)} required={def.required}>
          <option value="">—</option>
          <option value="true">Sim</option>
          <option value="false">Não</option>
        </Select>
      );
    case "select":
      return (
        <Select name={name} defaultValue={text} required={def.required}>
          <option value="">—</option>
          {def.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      );
    case "multiselect": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <span className="flex flex-wrap gap-3">
          {def.options.map((option) => (
            <span key={option} className="inline-flex items-center gap-1">
              <input type="checkbox" name={name} value={option} defaultChecked={selected.includes(option)} />
              {option}
            </span>
          ))}
        </span>
      );
    }
    default:
      return <Input name={name} defaultValue={text} maxLength={1000} required={def.required} />;
  }
}

/** Valor de um campo customizado formatado para leitura. */
export function formatCustomValue(def: CustomFieldDef, value: unknown) {
  if (value === undefined || value === null) return "—";
  if (def.type === "boolean") return value ? "Sim" : "Não";
  if (def.type === "multiselect" && Array.isArray(value)) return value.join(", ");
  if (def.type === "date" && typeof value === "string") return value.split("-").reverse().join("/");
  if (def.type === "number" && typeof value === "number") return value.toLocaleString("pt-BR");
  return String(value);
}
