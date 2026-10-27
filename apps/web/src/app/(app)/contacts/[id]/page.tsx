import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Card, Input, Notice, Select } from "@/components/ui";
import { ApiError, type CompanySummary, type Contact, type Page } from "@/lib/api";
import { CHANNELS, CONTACT_TYPES, formatIdentifier, LGPD } from "@/lib/labels";
import { canDelete, canEdit, requireWorkspace, workspaceApi } from "@/lib/session";
import {
  addIdentity,
  deleteContact,
  makePrimaryIdentity,
  removeIdentity,
  setContactArchived,
  updateContact,
} from "../actions";

export default async function ContactPage({ params, searchParams }: PageProps<"/contacts/[id]">) {
  const [{ id }, query, current] = await Promise.all([params, searchParams, requireWorkspace()]);
  const contact = await workspaceApi<Contact>(`/contacts/${id}`).catch((error) => {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  });
  const companies = await workspaceApi<Page<CompanySummary>>("/companies?limit=100");
  const editable = canEdit(current);
  const error = typeof query.error === "string" ? query.error : undefined;

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/contacts" className="text-sm text-zinc-500 hover:underline">
          ← Contatos
        </Link>
        <h1 className="text-xl font-semibold">{contact.name}</h1>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
          {CONTACT_TYPES[contact.type]}
        </span>
        {contact.archivedAt && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Arquivado
          </span>
        )}
      </div>
      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Dados">
          <form action={updateContact} className="space-y-3">
            <input type="hidden" name="id" value={contact.id} />
            <fieldset disabled={!editable} className="space-y-3">
              <label className="block space-y-1 text-sm">
                <span>Nome</span>
                <Input name="name" defaultValue={contact.name} required maxLength={200} />
              </label>
              <label className="block space-y-1 text-sm">
                <span>Tipo</span>
                <Select name="type" defaultValue={contact.type}>
                  {Object.entries(CONTACT_TYPES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block space-y-1 text-sm">
                <span>Empresa</span>
                <Select name="companyId" defaultValue={contact.company?.id ?? ""}>
                  <option value="">Sem empresa</option>
                  {companies.items.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block space-y-1 text-sm">
                <span>LGPD</span>
                <Select name="lgpdStatus" defaultValue={contact.lgpdStatus}>
                  {Object.entries(LGPD).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </label>
              {editable && <Button>Salvar</Button>}
            </fieldset>
          </form>
        </Card>

        <Card title="Canais">
          <ul className="mb-4 divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {contact.identities.length === 0 && <li className="py-2 text-zinc-500">Nenhum canal cadastrado.</li>}
            {contact.identities.map((identity) => (
              <li key={identity.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="w-20 text-xs text-zinc-500">{CHANNELS[identity.channel]}</span>
                <span className="flex-1">{formatIdentifier(identity.channel, identity.identifier)}</span>
                {identity.isPrimary && <span className="text-xs text-indigo-600">principal</span>}
                {identity.verified && <span className="text-xs text-emerald-600">verificado</span>}
                {editable && !identity.isPrimary && (
                  <form action={makePrimaryIdentity}>
                    <input type="hidden" name="id" value={contact.id} />
                    <input type="hidden" name="identityId" value={identity.id} />
                    <button className="text-xs text-zinc-500 hover:underline">tornar principal</button>
                  </form>
                )}
                {editable && (
                  <form action={removeIdentity}>
                    <input type="hidden" name="id" value={contact.id} />
                    <input type="hidden" name="identityId" value={identity.id} />
                    <button className="text-xs text-red-600 hover:underline">remover</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {editable && (
            <form action={addIdentity} className="flex flex-wrap gap-2">
              <input type="hidden" name="id" value={contact.id} />
              <Select name="channel" defaultValue="whatsapp" aria-label="Canal">
                {Object.entries(CHANNELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <div className="min-w-40 flex-1">
                <Input name="identifier" required placeholder="Número, e-mail ou @usuário" />
              </div>
              <Button>Adicionar</Button>
            </form>
          )}
        </Card>
      </div>

      {editable && (
        <div className="flex flex-wrap gap-2">
          <form action={setContactArchived}>
            <input type="hidden" name="id" value={contact.id} />
            <input type="hidden" name="archive" value={String(!contact.archivedAt)} />
            <Button variant="ghost">{contact.archivedAt ? "Desarquivar" : "Arquivar"}</Button>
          </form>
          {canDelete(current) && (
            <form action={deleteContact} className="flex items-center gap-2">
              <input type="hidden" name="id" value={contact.id} />
              <label className="flex items-center gap-1 text-xs text-zinc-500">
                <input type="checkbox" required /> apagar contato e canais de forma permanente
              </label>
              <Button variant="ghost">Excluir</Button>
            </form>
          )}
        </div>
      )}
      <p className="text-xs text-zinc-500">
        Criado em {new Date(contact.createdAt).toLocaleString("pt-BR", { timeZone: current.workspace.timezone })}
      </p>
    </main>
  );
}
