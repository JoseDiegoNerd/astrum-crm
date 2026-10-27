import Link from "next/link";
import { CustomFieldInputs, TagChips } from "@/components/crm";
import { Button, Card, Input, Notice, Select } from "@/components/ui";
import type { CompanySummary, ContactSummary, CustomFieldDef, Page, TagSummary } from "@/lib/api";
import { CHANNELS, CONTACT_TYPES, formatIdentifier } from "@/lib/labels";
import { canEdit, requireWorkspace, workspaceApi } from "@/lib/session";
import { createContact } from "./actions";

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  const params = await searchParams;
  const str = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);
  const q = str("q") ?? "";
  const type = str("type") ?? "";
  const tag = str("tag") ?? "";
  const archived = str("archived") === "true";

  const query = new URLSearchParams({ archived: String(archived), limit: "50" });
  if (q) query.set("q", q);
  if (type) query.set("type", type);
  if (tag) query.set("tag", tag);
  if (str("cursor")) query.set("cursor", str("cursor")!);

  const [current, contacts, companies, tags, fields] = await Promise.all([
    requireWorkspace(),
    workspaceApi<Page<ContactSummary>>(`/contacts?${query}`),
    workspaceApi<Page<CompanySummary>>("/companies?limit=100"),
    workspaceApi<TagSummary[]>("/tags"),
    workspaceApi<CustomFieldDef[]>("/custom-fields?entity=contact"),
  ]);
  // no cadastro rápido entram só os campos obrigatórios; o resto fica na ficha
  const requiredFields = fields.filter((f) => f.required);
  const nextPage = new URLSearchParams(query);
  if (contacts.nextCursor) nextPage.set("cursor", contacts.nextCursor);

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 p-6 lg:grid-cols-[1fr_320px]">
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold">Contatos</h1>
          <span className="text-sm text-zinc-500">{current.workspace.name}</span>
        </div>
        {str("error") && <Notice tone="error">{str("error")}</Notice>}

        <form className="flex flex-wrap gap-2">
          <div className="min-w-56 flex-1">
            <Input name="q" defaultValue={q} placeholder="Buscar por nome, telefone, e-mail ou @" />
          </div>
          <Select name="type" defaultValue={type} aria-label="Tipo">
            <option value="">Todos os tipos</option>
            {Object.entries(CONTACT_TYPES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Select name="tag" defaultValue={tag} aria-label="Tag">
            <option value="">Todas as tags</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Select name="archived" defaultValue={String(archived)} aria-label="Situação">
            <option value="false">Ativos</option>
            <option value="true">Arquivados</option>
          </Select>
          <Button variant="ghost">Filtrar</Button>
        </form>

        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-2">Nome</th>
                <th className="px-4 py-2">Contato principal</th>
                <th className="px-4 py-2">Empresa</th>
                <th className="px-4 py-2">Tipo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {contacts.items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">
                    {q || type || tag ? "Nenhum contato encontrado com esses filtros." : "Nenhum contato ainda."}
                  </td>
                </tr>
              )}
              {contacts.items.map((c) => {
                const primary = c.identities.find((i) => i.isPrimary) ?? c.identities[0];
                return (
                  <tr key={c.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <td className="px-4 py-2">
                      <Link href={`/contacts/${c.id}`} className="mr-2 font-medium hover:underline">
                        {c.name}
                      </Link>
                      <TagChips tags={c.tags} />
                    </td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">
                      {primary && (
                        <>
                          <span className="text-xs text-zinc-400">{CHANNELS[primary.channel]} </span>
                          {formatIdentifier(primary.channel, primary.identifier)}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {c.companyId && (
                        <Link href={`/companies/${c.companyId}`} className="hover:underline">
                          {c.companyName}
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-2">{CONTACT_TYPES[c.type]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {contacts.nextCursor && (
          <Link href={`/contacts?${nextPage}`} className="text-sm text-indigo-600 hover:underline">
            Próxima página →
          </Link>
        )}
      </section>

      {canEdit(current) && (
        <aside>
          <Card title="Novo contato">
            <form action={createContact} className="space-y-3">
              <Input name="name" required maxLength={200} placeholder="Nome" />
              <Input name="whatsapp" placeholder="WhatsApp — (11) 99999-0000" inputMode="tel" />
              <Input name="email" type="email" placeholder="E-mail" />
              <Select name="type" defaultValue="lead" aria-label="Tipo">
                {Object.entries(CONTACT_TYPES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <Select name="companyId" defaultValue="" aria-label="Empresa">
                <option value="">Sem empresa</option>
                {companies.items.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </Select>
              <CustomFieldInputs defs={requiredFields} />
              <Button>Criar contato</Button>
            </form>
          </Card>
        </aside>
      )}
    </main>
  );
}
