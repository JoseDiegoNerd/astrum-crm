import { Button, Card, Input, Notice, Select } from "@/components/ui";
import type { CustomFieldDef, CustomFieldEntity, CustomFieldType, Tag } from "@/lib/api";
import { canDelete, requireWorkspace, workspaceApi } from "@/lib/session";
import { createField, createTag, deleteField, deleteTag, updateField, updateTag } from "./actions";

const ENTITIES: Partial<Record<CustomFieldEntity, string>> = { contact: "Contatos", company: "Empresas" };
const TYPES: Record<CustomFieldType, string> = {
  text: "Texto",
  number: "Número",
  date: "Data",
  boolean: "Sim/Não",
  select: "Seleção única",
  multiselect: "Seleção múltipla",
};

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const [{ error }, current, tags, fields] = await Promise.all([
    searchParams,
    requireWorkspace(),
    workspaceApi<Tag[]>("/tags"),
    workspaceApi<CustomFieldDef[]>("/custom-fields"),
  ]);
  // configuração do workspace é de managers (owner/admin da conta contam como manager)
  const manage = canDelete(current);

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Configurações · {current.workspace.name}</h1>
        {!manage && <p className="text-sm text-zinc-500">Somente managers do workspace alteram estas configurações.</p>}
      </div>
      {typeof error === "string" && <Notice tone="error">{error}</Notice>}

      <Card title="Tags">
        <ul className="mb-4 divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          {tags.length === 0 && <li className="py-2 text-zinc-500">Nenhuma tag ainda.</li>}
          {tags.map((tag) => (
            <li key={tag.id} className="flex flex-wrap items-center gap-2 py-2">
              {manage ? (
                <form action={updateTag} className="flex flex-1 flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={tag.id} />
                  <input type="color" name="color" defaultValue={tag.color} aria-label="Cor" className="h-8 w-10" />
                  <div className="min-w-40 flex-1">
                    <Input name="name" defaultValue={tag.name} required maxLength={50} />
                  </div>
                  <Button variant="ghost">Salvar</Button>
                </form>
              ) : (
                <span className="flex-1">
                  <span className="mr-2 inline-block h-3 w-3 rounded-full" style={{ backgroundColor: tag.color }} />
                  {tag.name}
                </span>
              )}
              <span className="text-xs text-zinc-500">
                {tag.usage.contacts} contatos · {tag.usage.companies} empresas
              </span>
              {manage && (
                <form action={deleteTag}>
                  <input type="hidden" name="id" value={tag.id} />
                  <button className="text-xs text-red-600 hover:underline">excluir</button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {manage && (
          <form action={createTag} className="flex flex-wrap items-center gap-2">
            <input type="color" name="color" defaultValue="#6366f1" aria-label="Cor" className="h-8 w-10" />
            <div className="min-w-40 flex-1">
              <Input name="name" required maxLength={50} placeholder="Nova tag" />
            </div>
            <Button>Criar tag</Button>
          </form>
        )}
      </Card>

      <Card title="Campos customizados">
        {Object.entries(ENTITIES).map(([entity, label]) => {
          const defs = fields.filter((f) => f.entity === entity);
          return (
            <div key={entity} className="mb-6">
              <h3 className="mb-2 text-sm font-medium">{label}</h3>
              <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                {defs.length === 0 && <li className="py-2 text-zinc-500">Nenhum campo.</li>}
                {defs.map((def) => (
                  <li key={def.id} className="py-2">
                    {manage ? (
                      <form action={updateField} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="id" value={def.id} />
                        <div className="min-w-40 flex-1">
                          <Input name="label" defaultValue={def.label} required maxLength={80} />
                        </div>
                        <span className="text-xs text-zinc-500">
                          {TYPES[def.type]} · <code>{def.key}</code>
                        </span>
                        {(def.type === "select" || def.type === "multiselect") && (
                          <div className="w-full">
                            <Input name="options" defaultValue={def.options.join(", ")} placeholder="Opções separadas por vírgula" />
                          </div>
                        )}
                        <label className="flex items-center gap-1 text-xs">
                          <input type="checkbox" name="required" defaultChecked={def.required} /> obrigatório
                        </label>
                        <Button variant="ghost">Salvar</Button>
                        <button formAction={deleteField} className="text-xs text-red-600 hover:underline">
                          excluir
                        </button>
                      </form>
                    ) : (
                      <span>
                        {def.label} <span className="text-xs text-zinc-500">· {TYPES[def.type]}{def.required && " · obrigatório"}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}

        {manage && (
          <form action={createField} className="grid gap-2 border-t border-zinc-200 pt-4 sm:grid-cols-2 dark:border-zinc-800">
            <Select name="entity" defaultValue="contact" aria-label="Entidade">
              {Object.entries(ENTITIES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Select name="type" defaultValue="text" aria-label="Tipo">
              {Object.entries(TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Input name="label" required maxLength={80} placeholder="Nome do campo (ex.: Origem do lead)" />
            <Input name="options" placeholder="Opções (só para seleção), separadas por vírgula" />
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" name="required" /> obrigatório
            </label>
            <div>
              <Button>Criar campo</Button>
            </div>
          </form>
        )}
      </Card>
    </main>
  );
}
