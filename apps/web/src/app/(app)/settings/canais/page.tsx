import Link from "next/link";
import { Button, Card, Input, Notice } from "@/components/ui";
import type { Channel } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import { canDelete, requireWorkspace, workspaceApi } from "@/lib/session";
import { deleteChannel, testChannel, toggleChannel, updateChannel } from "./actions";
import { ConnectWhatsAppForm, RotateVerifyTokenForm } from "./forms";

const STATUS: Record<Channel["status"], { label: string; className: string }> = {
  connected: { label: "Conectado", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  pending: { label: "Aguardando teste", className: "bg-zinc-100 dark:bg-zinc-800" },
  error: { label: "Com erro", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  disabled: { label: "Desativado", className: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
};

export default async function ChannelsSettingsPage({ searchParams }: PageProps<"/settings/canais">) {
  const [{ error }, current, channels] = await Promise.all([
    searchParams,
    requireWorkspace(),
    workspaceApi<Channel[]>("/channels"),
  ]);
  const manage = canDelete(current);
  const timezone = current.workspace.timezone;

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <div>
        <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
          ← Configurações
        </Link>
        <h1 className="text-xl font-semibold">Canais · {current.workspace.name}</h1>
        <p className="text-sm text-zinc-500">
          Números de WhatsApp conectados a este workspace. Mensagens recebidas viram conversas no Inbox.
          {!manage && " Somente managers conectam e configuram canais."}
        </p>
      </div>
      {typeof error === "string" && <Notice tone="error">{error}</Notice>}

      {channels.length === 0 && <Notice tone="info">Nenhum canal conectado ainda.</Notice>}

      {channels.map((channel) => (
        <Card key={channel.id} title={`${channel.name} · WhatsApp`}>
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[channel.status].className}`}>{STATUS[channel.status].label}</span>
              {channel.displayIdentifier && <span className="font-medium">{channel.displayIdentifier}</span>}
              {channel.config.verifiedName && <span className="text-zinc-500">· {channel.config.verifiedName}</span>}
              {channel.connectedAt && (
                <span className="text-xs text-zinc-500">· testado em {formatDateTime(channel.connectedAt, timezone)}</span>
              )}
            </div>
            {channel.lastError && <Notice tone="error">A Meta respondeu: {channel.lastError}</Notice>}
            <label className="block space-y-1">
              <span className="text-xs text-zinc-500">URL do webhook (cadastrada no painel da Meta)</span>
              <input readOnly value={channel.webhookUrl} className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 font-mono text-xs dark:border-zinc-700" />
            </label>
            <div className="text-xs text-zinc-500">
              ID do número: {channel.externalId} · Conta (WABA): {channel.externalAccountId}
            </div>

            {manage && (
              <>
                <div className="flex flex-wrap gap-2">
                  <form action={testChannel}>
                    <input type="hidden" name="id" value={channel.id} />
                    <Button variant="ghost">Testar conexão</Button>
                  </form>
                  <RotateVerifyTokenForm channelId={channel.id} />
                  <form action={toggleChannel}>
                    <input type="hidden" name="id" value={channel.id} />
                    <input type="hidden" name="enable" value={String(channel.status === "disabled")} />
                    <Button variant="ghost">{channel.status === "disabled" ? "Reativar" : "Desativar"}</Button>
                  </form>
                </div>

                <details className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <summary className="cursor-pointer text-sm font-medium">Editar nome ou credenciais</summary>
                  <form action={updateChannel} className="mt-3 grid gap-2 sm:grid-cols-2">
                    <input type="hidden" name="id" value={channel.id} />
                    <Input name="name" defaultValue={channel.name} maxLength={80} aria-label="Nome" />
                    <Input name="phoneNumberId" placeholder="Novo ID do número (opcional)" inputMode="numeric" />
                    <Input name="wabaId" placeholder="Novo ID da conta (opcional)" inputMode="numeric" />
                    <Input name="appSecret" type="password" autoComplete="off" placeholder="Nova chave secreta (opcional)" />
                    <div className="sm:col-span-2">
                      <Input name="accessToken" type="password" autoComplete="off" placeholder="Novo token de acesso (opcional)" />
                    </div>
                    <p className="text-xs text-zinc-500 sm:col-span-2">Campos vazios mantêm o valor atual. Trocar token ou número testa de novo na Meta.</p>
                    <div>
                      <Button>Salvar</Button>
                    </div>
                  </form>
                </details>

                <form action={deleteChannel} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={channel.id} />
                  <label className="flex items-center gap-1 text-xs text-zinc-500">
                    <input type="checkbox" required /> excluir este canal (só é possível se não tiver conversas)
                  </label>
                  <Button variant="ghost">Excluir</Button>
                </form>
              </>
            )}
          </div>
        </Card>
      ))}

      {manage && (
        <Card title="Conectar um número de WhatsApp">
          <ConnectWhatsAppForm />
        </Card>
      )}
    </main>
  );
}
