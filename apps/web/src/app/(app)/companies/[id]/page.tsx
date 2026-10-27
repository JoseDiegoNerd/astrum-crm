import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomFieldInputs, TagChips } from "@/components/crm";
import { Button, Card, Input, Notice } from "@/components/ui";
import { ApiError, type Company, type CustomFieldDef, type DealSummary, type Page, type TagSummary } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { CONTACT_TYPES, formatCnpj, formatIdentifier } from "@/lib/labels";
import { canDelete, canEdit, requireWorkspace, workspaceApi } from "@/lib/session";
import { deleteCompany, setCompanyArchived, setCompanyTags, updateCompany } from "../actions";

export default async function CompanyPage({ params, searchParams }: PageProps<"/companies/[id]">) {
  const [{ id }, query, current] = await Promise.all([params, searchParams, requireWorkspace()]);
  const company = await workspaceApi<Company>(`/companies/${id}`).catch((error) => {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  });
  const [tags, fields, relatedDeals] = await Promise.all([
    workspaceApi<TagSummary[]>("/tags"),
    workspaceApi<CustomFieldDef[]>("/custom-fields?entity=company"),
    workspaceApi<Page<DealSummary>>(`/deals?company=${id}&limit=20`),
  ]);
  const editable = canEdit(current);
  const error = typeof query.error === "string" ? query.error : undefined;

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/companies" className="text-sm text-zinc-500 hover:underline">
          ← Empresas
        </Link>
        <h1 className="text-xl font-semibold">{company.name}</h1>
        <TagChips tags={company.tags} />
        {company.archivedAt && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Arquivada
          </span>
        )}
      </div>
      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Dados">
          <form action={updateCompany} className="space-y-3">
            <input type="hidden" name="id" value={company.id} />
            <fieldset disabled={!editable} className="space-y-3">
              <label className="block space-y-1 text-sm">
                <span>Nome</span>
                <Input name="name" defaultValue={company.name} required maxLength={200} />
              </label>
              <label className="block space-y-1 text-sm">
                <span>CNPJ</span>
                <Input name="document" defaultValue={company.document ? formatCnpj(company.document) : ""} />
              </label>
              <label className="block space-y-1 text-sm">
                <span>Domínio</span>
                <Input name="domain" defaultValue={company.domain ?? ""} />
              </label>
              <label className="block space-y-1 text-sm">
                <span>Telefone</span>
                <Input name="phone" defaultValue={company.phone ? formatIdentifier("phone", company.phone) : ""} />
              </label>
              <CustomFieldInputs defs={fields} values={company.custom} />
              {editable && <Button>Salvar</Button>}
            </fieldset>
          </form>
        </Card>

        <Card title={`Contatos (${company.contacts.length})`}>
          <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {company.contacts.length === 0 && (
              <li className="py-2 text-zinc-500">Vincule contatos a esta empresa pela ficha do contato.</li>
            )}
            {company.contacts.map((contact) => (
              <li key={contact.id} className="flex justify-between py-2">
                <Link href={`/contacts/${contact.id}`} className="hover:underline">
                  {contact.name}
                </Link>
                <span className="text-zinc-500">{CONTACT_TYPES[contact.type]}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Negócios">
        <ul className="mb-3 divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          {relatedDeals.items.length === 0 && <li className="py-2 text-zinc-500">Nenhum negócio.</li>}
          {relatedDeals.items.map((deal) => (
            <li key={deal.id} className="flex justify-between gap-2 py-2">
              <Link href={`/deals/${deal.id}`} className="hover:underline">
                {deal.title}
              </Link>
              <span className="text-zinc-500">
                {deal.stageName} · {formatMoney(deal.valueCents, deal.currency)}
              </span>
            </li>
          ))}
        </ul>
        {editable && (
          <Link href={`/deals?company=${company.id}`} className="text-sm text-indigo-600 hover:underline">
            + Novo negócio
          </Link>
        )}
      </Card>

      {tags.length > 0 && (
        <Card title="Tags">
          <form action={setCompanyTags} className="flex flex-wrap items-center gap-3 text-sm">
            <input type="hidden" name="id" value={company.id} />
            <fieldset disabled={!editable} className="flex flex-wrap gap-3">
              {tags.map((tag) => (
                <label key={tag.id} className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    name="tagIds"
                    value={tag.id}
                    defaultChecked={company.tags.some((t) => t.id === tag.id)}
                  />
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
                  {tag.name}
                </label>
              ))}
            </fieldset>
            {editable && <Button variant="ghost">Salvar tags</Button>}
          </form>
        </Card>
      )}

      {editable && (
        <div className="flex flex-wrap gap-2">
          <form action={setCompanyArchived}>
            <input type="hidden" name="id" value={company.id} />
            <input type="hidden" name="archive" value={String(!company.archivedAt)} />
            <Button variant="ghost">{company.archivedAt ? "Desarquivar" : "Arquivar"}</Button>
          </form>
          {canDelete(current) && (
            <form action={deleteCompany} className="flex items-center gap-2">
              <input type="hidden" name="id" value={company.id} />
              <label className="flex items-center gap-1 text-xs text-zinc-500">
                <input type="checkbox" required /> apagar empresa (os contatos ficam, sem vínculo)
              </label>
              <Button variant="ghost">Excluir</Button>
            </form>
          )}
        </div>
      )}
    </main>
  );
}
