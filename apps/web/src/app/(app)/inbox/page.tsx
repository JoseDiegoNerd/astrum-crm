import Link from "next/link";
import { Button, Input, Notice, Select } from "@/components/ui";
import {
  api,
  type Contact,
  type Conversation,
  type DealSummary,
  type InboxMessage,
  type MessageStatus,
  type MessageTemplate,
  type Page,
  type TenantMember,
} from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import { CHANNELS, formatIdentifier } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { canDelete, canEdit, getSession, requireWorkspace, workspaceApi } from "@/lib/session";
import { updateConversation } from "./actions";
import { Composer } from "./composer";
import { InboxLive, MarkRead, ScrollToBottom } from "./live";

const VIEWS = [
  { key: "mine", label: "Minhas", assignee: "me" },
  { key: "none", label: "Sem dono", assignee: "none" },
  { key: "all", label: "Todas", assignee: "any" },
] as const;

const STATUS_LABEL = { open: "Aberta", pending: "Pendente", resolved: "Resolvida" } as const;

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const params = await searchParams;
  const str = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);
  const view = VIEWS.find((v) => v.key === str("view")) ?? VIEWS[2];
  const resolved = str("status") === "resolved";
  const q = str("q") ?? "";
  const selectedId = str("c");

  const [current, { me }] = await Promise.all([requireWorkspace(), getSession()]);
  const timezone = current.workspace.timezone;
  const listQuery = new URLSearchParams({ assignee: view.assignee, status: resolved ? "resolved" : "active", limit: "50" });
  if (q) listQuery.set("q", q);

  const list = await workspaceApi<Page<Conversation>>(`/conversations?${listQuery}`);
  // link de cada item mantém filtros e troca só a conversa aberta
  const hrefFor = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { view: view.key, status: resolved ? "resolved" : undefined, q: q || undefined, c: selectedId, ...overrides };
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
    return `/inbox?${next}`;
  };

  return (
    <main className="flex h-[calc(100vh-57px)] min-h-0 w-full">
      <InboxLive workspaceId={current.workspace.id} />

      {/* Lista de conversas */}
      <aside className={`${selectedId ? "hidden md:flex" : "flex"} w-full flex-col border-r border-zinc-200 md:w-80 dark:border-zinc-800`}>
        <div className="space-y-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
          <nav className="flex gap-1 rounded-lg bg-zinc-100 p-1 text-sm dark:bg-zinc-900">
            {VIEWS.map((v) => (
              <Link
                key={v.key}
                href={hrefFor({ view: v.key, c: undefined })}
                className={`flex-1 rounded-md px-2 py-1 text-center ${
                  v.key === view.key ? "bg-white shadow-sm dark:bg-zinc-800" : "text-zinc-600 dark:text-zinc-400"
                }`}
              >
                {v.label}
              </Link>
            ))}
          </nav>
          <form className="flex gap-2">
            <input type="hidden" name="view" value={view.key} />
            {resolved && <input type="hidden" name="status" value="resolved" />}
            <div className="flex-1">
              <Input name="q" defaultValue={q} placeholder="Buscar contato ou número" />
            </div>
          </form>
          <Link href={hrefFor({ status: resolved ? undefined : "resolved", c: undefined })} className="text-xs text-indigo-600 hover:underline">
            {resolved ? "← Ver conversas ativas" : "Ver resolvidas"}
          </Link>
        </div>

        <ul className="flex-1 overflow-y-auto">
          {list.items.length === 0 && (
            <li className="p-6 text-center text-sm text-zinc-500">
              {view.key === "mine" ? "Nenhuma conversa com você." : "Nenhuma conversa por aqui."}
              <Link href="/settings/canais" className="mt-2 block text-xs text-indigo-600 hover:underline">
                Conectar um WhatsApp
              </Link>
            </li>
          )}
          {list.items.map((conversation) => (
            <li key={conversation.id}>
              <Link
                href={hrefFor({ c: conversation.id })}
                className={`block border-b border-zinc-100 px-3 py-2.5 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900 ${
                  conversation.id === selectedId ? "bg-indigo-50 dark:bg-indigo-950" : ""
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`truncate text-sm ${conversation.unreadCount > 0 ? "font-semibold" : "font-medium"}`}>
                    {conversation.contactName}
                  </span>
                  <time className="shrink-0 text-xs text-zinc-500">{formatDateTime(conversation.activityAt, timezone)}</time>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-zinc-500">
                    {conversation.lastMessage?.direction === "out" && "Você: "}
                    {preview(conversation.lastMessage)}
                  </span>
                  {conversation.unreadCount > 0 && (
                    <span className="shrink-0 rounded-full bg-indigo-600 px-1.5 text-[10px] font-semibold text-white">
                      {conversation.unreadCount}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex gap-2 text-[10px] text-zinc-400">
                  <span>{conversation.channelName}</span>
                  {conversation.assigneeName && <span>· {conversation.assigneeName}</span>}
                  {conversation.status === "pending" && <span className="text-amber-600">· pendente</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      {/* Conversa aberta + painel do contato */}
      {selectedId ? (
        <ConversationPane
          id={selectedId}
          backHref={hrefFor({ c: undefined })}
          selfHref={hrefFor({})}
          error={str("error")}
          timezone={timezone}
          meId={me.profile?.id}
          tenantId={current.tenant.id}
          editable={canEdit(current)}
          manager={canDelete(current)}
        />
      ) : (
        <section className="hidden flex-1 items-center justify-center text-sm text-zinc-500 md:flex">
          Escolha uma conversa à esquerda.
        </section>
      )}
    </main>
  );
}

async function ConversationPane(props: {
  id: string;
  backHref: string;
  selfHref: string;
  error?: string;
  timezone: string;
  meId?: string;
  tenantId: string;
  editable: boolean;
  manager: boolean;
}) {
  const { id, timezone, editable, manager } = props;
  const conversation = await workspaceApi<Conversation>(`/conversations/${id}`).catch(() => null);
  if (!conversation) {
    return (
      <section className="flex flex-1 items-center justify-center p-6">
        <Notice tone="error">Conversa não encontrada.</Notice>
      </section>
    );
  }
  const [messages, contact, deals, members] = await Promise.all([
    workspaceApi<{ items: InboxMessage[]; previousCursor: string | null }>(`/conversations/${id}/messages?limit=100`),
    workspaceApi<Contact>(`/contacts/${conversation.contactId}`),
    workspaceApi<Page<DealSummary>>(`/deals?contact=${conversation.contactId}&status=open&limit=5`),
    manager ? api<TenantMember[]>(`/tenants/${props.tenantId}/members`) : Promise.resolve([]),
  ]);
  const isResolved = conversation.status === "resolved";
  // fora da janela de 24 h só vai template: sugere os aprovados na Meta
  const templates =
    !conversation.capabilities.freeText && editable && !isResolved
      ? await workspaceApi<MessageTemplate[]>(`/channels/${conversation.channelId}/templates`).catch(() => [])
      : [];
  const lastId = messages.items.at(-1)?.id ?? "vazio";

  return (
    <>
      <MarkRead conversationId={id} unread={conversation.unreadCount} />
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <Link href={props.backHref} className="text-sm text-zinc-500 md:hidden">
            ←
          </Link>
          <div className="min-w-0">
            <div className="truncate font-medium">{conversation.contactName}</div>
            <div className="text-xs text-zinc-500">
              {conversation.channelName} · {STATUS_LABEL[conversation.status]}
              {conversation.assigneeName ? ` · com ${conversation.assigneeName}` : " · sem dono"}
            </div>
          </div>

          {editable && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {conversation.assigneeId !== props.meId && !isResolved && (
                <ConversationButton id={id} back={props.selfHref} field="assigneeId" value={props.meId ?? ""} label="Pegar para mim" />
              )}
              {manager && !isResolved && (
                <form action={updateConversation} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="back" value={props.selfHref} />
                  <Select name="assigneeId" defaultValue={conversation.assigneeId ?? ""} aria-label="Responsável">
                    <option value="">Sem dono</option>
                    {members
                      .filter((m) => m.status === "active")
                      .map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.name ?? m.email}
                        </option>
                      ))}
                  </Select>
                  <Button variant="ghost">Atribuir</Button>
                </form>
              )}
              {conversation.status === "open" && (
                <ConversationButton id={id} back={props.selfHref} field="status" value="pending" label="Pendente" />
              )}
              {isResolved ? (
                <ConversationButton id={id} back={props.selfHref} field="status" value="open" label="Reabrir" />
              ) : (
                <ConversationButton id={id} back={props.selfHref} field="status" value="resolved" label="Resolver" primary />
              )}
            </div>
          )}
        </header>
        {props.error && (
          <div className="px-4 pt-2">
            <Notice tone="error">{props.error}</Notice>
          </div>
        )}

        <ScrollToBottom watch={`${id}:${lastId}`}>
          {messages.items.length === 0 && <p className="text-center text-sm text-zinc-500">Nenhuma mensagem ainda.</p>}
          <ol className="space-y-2">
            {messages.items.map((message) => (
              <MessageBubble key={message.id} message={message} timezone={timezone} />
            ))}
          </ol>
        </ScrollToBottom>

        <Composer
          conversationId={id}
          freeText={conversation.capabilities.freeText}
          reason={conversation.capabilities.reason}
          templates={templates}
          disabled={
            !editable
              ? "Seu papel neste workspace é de leitura."
              : isResolved
                ? "Conversa resolvida. Reabra para responder."
                : undefined
          }
        />
      </section>

      {/* Painel do contato */}
      <aside className="hidden w-72 shrink-0 space-y-4 overflow-y-auto border-l border-zinc-200 p-4 text-sm lg:block dark:border-zinc-800">
        <div>
          <Link href={`/contacts/${contact.id}`} className="font-medium hover:underline">
            {contact.name}
          </Link>
          {contact.company && (
            <div className="text-xs text-zinc-500">
              <Link href={`/companies/${contact.company.id}`} className="hover:underline">
                {contact.company.name}
              </Link>
            </div>
          )}
        </div>
        <ul className="space-y-1">
          {contact.identities.map((identity) => (
            <li key={identity.id} className="text-xs">
              <span className="text-zinc-500">{CHANNELS[identity.channel]} </span>
              {formatIdentifier(identity.channel, identity.identifier)}
              {identity.verified && <span className="text-emerald-600"> ✓</span>}
            </li>
          ))}
        </ul>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase text-zinc-500">Negócios em aberto</div>
          {deals.items.length === 0 && <p className="text-xs text-zinc-500">Nenhum.</p>}
          <ul className="space-y-1">
            {deals.items.map((deal) => (
              <li key={deal.id} className="text-xs">
                <Link href={`/deals/${deal.id}`} className="hover:underline">
                  {deal.title}
                </Link>
                <span className="text-zinc-500">
                  {" "}
                  · {deal.stageName} · {formatMoney(deal.valueCents, deal.currency)}
                </span>
              </li>
            ))}
          </ul>
          {editable && (
            <Link href={`/deals?contact=${contact.id}`} className="mt-2 inline-block text-xs text-indigo-600 hover:underline">
              + Novo negócio
            </Link>
          )}
        </div>
      </aside>
    </>
  );
}

function ConversationButton({
  id,
  back,
  field,
  value,
  label,
  primary,
}: {
  id: string;
  back: string;
  field: "status" | "assigneeId";
  value: string;
  label: string;
  primary?: boolean;
}) {
  return (
    <form action={updateConversation}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name={field} value={value} />
      <Button variant={primary ? "primary" : "ghost"}>{label}</Button>
    </form>
  );
}

const TICKS: Record<MessageStatus, { label: string; className: string }> = {
  received: { label: "", className: "" },
  queued: { label: "🕓", className: "opacity-70" },
  sent: { label: "✓", className: "opacity-70" },
  delivered: { label: "✓✓", className: "opacity-70" },
  read: { label: "✓✓", className: "text-sky-300" },
  failed: { label: "⚠", className: "text-red-200" },
};

function MessageBubble({ message, timezone }: { message: InboxMessage; timezone: string }) {
  const outgoing = message.direction === "out";
  const tick = TICKS[message.status];
  return (
    <li className={`flex ${outgoing ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
          outgoing
            ? message.status === "failed"
              ? "bg-red-600 text-white"
              : "bg-indigo-600 text-white"
            : "bg-zinc-100 dark:bg-zinc-800"
        }`}
      >
        {outgoing && message.senderName && <div className="mb-0.5 text-[10px] opacity-75">{message.senderName}</div>}
        <MessageBody message={message} />
        <div className={`mt-1 flex justify-end gap-1 text-[10px] ${outgoing ? "text-white/80" : "text-zinc-500"}`}>
          <time>{formatDateTime(message.createdAt, timezone)}</time>
          {outgoing && <span className={tick.className}>{tick.label}</span>}
        </div>
        {message.status === "failed" && message.error && (
          <div className="mt-1 text-[11px]">Não enviada: {message.error.title ?? message.error.message}</div>
        )}
      </div>
    </li>
  );
}

const MEDIA_LABEL: Record<string, string> = {
  image: "📷 Imagem",
  audio: "🎤 Áudio",
  video: "🎬 Vídeo",
  document: "📄 Documento",
  sticker: "Figurinha",
  location: "📍 Localização",
  unsupported: "Mensagem não suportada",
};

function MessageBody({ message }: { message: InboxMessage }) {
  const label = MEDIA_LABEL[message.type];
  return (
    <div className="whitespace-pre-wrap break-words">
      {label && <span className="mr-1 font-medium">{label}</span>}
      {message.body}
    </div>
  );
}

function preview(last: Conversation["lastMessage"]) {
  if (!last) return "Sem mensagens";
  return last.body || MEDIA_LABEL[last.type] || "Mensagem";
}
