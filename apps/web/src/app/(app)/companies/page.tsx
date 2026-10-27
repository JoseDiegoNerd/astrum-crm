import Link from "next/link";
import { CustomFieldInputs, TagChips } from "@/components/crm";
import { Button, Card, Input, Notice, Select } from "@/components/ui";
import type { CompanySummary, CustomFieldDef, Page, TagSummary } from "@/lib/api";
import { formatCnpj } from "@/lib/labels";
import { canEdit, requireWorkspace, workspaceApi } from "@/lib/session";
import { createCompany } from "./actions";

export default async function CompaniesPage({ searchParams }: PageProps<"/companies">) {
  const params = await searchParams;
  const str = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);
  const q = str("q") ?? "";
  const archived = str("archived") === "true";
  const tag = str("tag") ?? "";

  const query = new URLSearchParams({ archived: String(archived), limit: "50" });
  if (q) query.set("q", q);
  if (tag) query.set("tag", tag);
  if (str("cursor")) query.set("cursor", str("cursor")!);

  const [current, companies, tags, fields] = await Promise.all([
    requireWorkspace(),
    workspaceApi<Page<CompanySummary>>(`/companies?${query}`),
    workspaceApi<TagSummary[]>("/tags"),
    workspaceApi<CustomFieldDef[]>("/custom-fields?entity=company"),
  ]);
  const requiredFields = fields.filter((f) => f.required);
  const nextPage = new URLSearchParams(query);
  if (companies.nextCursor) nextPage.set("cursor", companies.nextCursor);

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 p-6 lg:grid-cols-[1fr_320px]">
      <section className="space-y-4">
        <h1 className="text-xl font-semibold">Empresas</h1>
        {str("error") && <Notice tone="error">{str("error")}</Notice>}

        <form className="flex flex-wrap gap-2">
          <div className="min-w-56 flex-1">
            <Input name="q" defaultValue={q} placeholder="Buscar por nome, domínio ou CNPJ" />
          </div>
          <Select name="tag" defaultValue={tag} aria-label="Tag">
            <option value="">Todas as tags</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Select name="archived" defaultValue={String(archived)} aria-label="Situação">
            <option value="false">Ativas</option>
            <option value="true">Arquivadas</option>
          </Select>
          <Button variant="ghost">Filtrar</Button>
        </form>

        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-2">Nome</th>
                <th className="px-4 py-2">CNPJ</th>
                <th className="px-4 py-2">Domínio</th>
                <th className="px-4 py-2 text-right">Contatos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {companies.items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">
                    {q || tag ? "Nenhuma empresa encontrada." : "Nenhuma empresa ainda."}
                  </td>
                </tr>
              )}
              {companies.items.map((company) => (
                <tr key={company.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
                  <td className="px-4 py-2">
                    <Link href={`/companies/${company.id}`} className="mr-2 font-medium hover:underline">
                      {company.name}
                    </Link>
                    <TagChips tags={company.tags} />
                  </td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">
                    {company.document && formatCnpj(company.document)}
                  </td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{company.domain}</td>
                  <td className="px-4 py-2 text-right">{company.contactCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {companies.nextCursor && (
          <Link href={`/companies?${nextPage}`} className="text-sm text-indigo-600 hover:underline">
            Próxima página →
          </Link>
        )}
      </section>

      {canEdit(current) && (
        <aside>
          <Card title="Nova empresa">
            <form action={createCompany} className="space-y-3">
              <Input name="name" required maxLength={200} placeholder="Nome" />
              <Input name="document" placeholder="CNPJ (opcional)" inputMode="numeric" />
              <Input name="domain" placeholder="Site ou domínio (opcional)" />
              <Input name="phone" placeholder="Telefone (opcional)" inputMode="tel" />
              <CustomFieldInputs defs={requiredFields} />
              <Button>Criar empresa</Button>
            </form>
          </Card>
        </aside>
      )}
    </main>
  );
}
