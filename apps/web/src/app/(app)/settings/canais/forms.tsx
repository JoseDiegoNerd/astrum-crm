"use client";

import { useActionState, useState } from "react";
import { Button, Input, Notice } from "@/components/ui";
import { connectWhatsApp, rotateVerifyToken, type WebhookSecretState } from "./actions";

/** Mostra URL e verify token para colar no painel da Meta — só desta vez. */
function WebhookSecret({ webhook }: { webhook: NonNullable<WebhookSecretState["webhook"]> }) {
  return (
    <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950">
      <p className="font-medium">Copie agora o verify token: ele não será mostrado de novo.</p>
      <CopyField label="URL de retorno (Callback URL)" value={webhook.url} />
      <CopyField label="Token de verificação (Verify token)" value={webhook.verifyToken} />
      <ol className="list-decimal space-y-1 pl-5 text-zinc-700 dark:text-zinc-300">
        <li>No painel do app em developers.facebook.com: <strong>WhatsApp → Configuração</strong>.</li>
        <li>Em <strong>Webhook</strong>, clique em <strong>Editar</strong>, cole a URL e o token acima e <strong>Verificar e salvar</strong>.</li>
        <li>Em <strong>Campos do webhook</strong>, assine o campo <strong>messages</strong>.</li>
        <li>Mande uma mensagem do seu celular para o número do canal: ela deve aparecer no Inbox.</li>
      </ol>
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <label className="block space-y-1">
      <span className="text-xs text-zinc-600 dark:text-zinc-400">{label}</span>
      <div className="flex gap-2">
        <input readOnly value={value} className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900" />
        <Button
          type="button"
          variant="ghost"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          }}
        >
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
    </label>
  );
}

export function ConnectWhatsAppForm() {
  const [state, action, pending] = useActionState<WebhookSecretState, FormData>(connectWhatsApp, {});

  if (state.webhook) {
    return (
      <div className="space-y-3">
        {state.status === "connected" ? (
          <Notice tone="info">“{state.channelName}” conectado: a Meta confirmou o número.</Notice>
        ) : (
          <Notice tone="error">
            “{state.channelName}” foi salvo, mas a Meta recusou: {state.lastError}. Corrija as credenciais no canal abaixo.
          </Notice>
        )}
        <WebhookSecret webhook={state.webhook} />
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span>Nome do canal</span>
          <Input name="name" required maxLength={80} placeholder="Ex.: WhatsApp Vendas" />
        </label>
        <label className="block space-y-1 text-sm">
          <span>ID do número de telefone</span>
          <Input name="phoneNumberId" required inputMode="numeric" placeholder="Phone number ID" />
        </label>
        <label className="block space-y-1 text-sm">
          <span>ID da conta do WhatsApp Business</span>
          <Input name="wabaId" required inputMode="numeric" placeholder="WhatsApp Business Account ID" />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Chave secreta do app</span>
          <Input name="appSecret" type="password" required autoComplete="off" placeholder="App Secret" />
        </label>
        <label className="block space-y-1 text-sm sm:col-span-2">
          <span>Token de acesso</span>
          <Input name="accessToken" type="password" required autoComplete="off" placeholder="Access token (de preferência permanente, de usuário do sistema)" />
        </label>
      </div>
      <p className="text-xs text-zinc-500">
        Os IDs ficam em developers.facebook.com → seu app → WhatsApp → Configuração da API. O token e a chave secreta são cifrados
        no servidor e nunca mais aparecem nesta tela.
      </p>
      <Button disabled={pending}>{pending ? "Conectando e testando…" : "Conectar WhatsApp"}</Button>
    </form>
  );
}

export function RotateVerifyTokenForm({ channelId }: { channelId: string }) {
  const [state, action, pending] = useActionState<WebhookSecretState, FormData>(rotateVerifyToken, {});
  if (state.webhook) return <WebhookSecret webhook={state.webhook} />;
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={channelId} />
      {state.error && <span className="mr-2 text-xs text-red-600">{state.error}</span>}
      <Button variant="ghost" disabled={pending}>
        Gerar novo verify token
      </Button>
    </form>
  );
}
