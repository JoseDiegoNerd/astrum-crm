"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button, Input } from "@/components/ui";
import { sendMessage, type SendState } from "./actions";

/**
 * Campo de resposta. Com a janela de 24 h fechada, o WhatsApp só aceita
 * templates aprovados — então o formulário vira o de template, com o motivo.
 */
export function Composer({
  conversationId,
  freeText,
  reason,
  disabled,
}: {
  conversationId: string;
  freeText: boolean;
  reason?: string;
  disabled?: string;
}) {
  const [state, action, pending] = useActionState<SendState, FormData>(sendMessage, {});
  const form = useRef<HTMLFormElement>(null);

  // limpa o campo depois de cada envio aceito
  useEffect(() => {
    if (state.sentAt) form.current?.reset();
  }, [state.sentAt]);

  if (disabled) {
    return <p className="border-t border-zinc-200 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800">{disabled}</p>;
  }

  return (
    <form ref={form} action={action} className="space-y-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
      <input type="hidden" name="conversationId" value={conversationId} />
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      {freeText ? (
        <>
          <input type="hidden" name="kind" value="text" />
          <div className="flex items-end gap-2">
            <textarea
              name="body"
              required
              maxLength={4096}
              rows={2}
              placeholder="Escreva a resposta… (Enter envia, Shift+Enter quebra linha)"
              aria-label="Mensagem"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  form.current?.requestSubmit();
                }
              }}
              className="flex-1 resize-none rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700"
            />
            <Button disabled={pending}>{pending ? "Enviando…" : "Enviar"}</Button>
          </div>
        </>
      ) : (
        <>
          <input type="hidden" name="kind" value="template" />
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">{reason}</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_100px]">
            <Input name="templateName" required placeholder="Nome do template aprovado (ex.: retomar_conversa)" />
            <Input name="templateLanguage" defaultValue="pt_BR" aria-label="Idioma" />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <Input name="templateParameters" placeholder="Parâmetros, separados por | (ex.: Ana|sexta-feira)" />
            </div>
            <Button disabled={pending}>{pending ? "Enviando…" : "Enviar template"}</Button>
          </div>
        </>
      )}
    </form>
  );
}
