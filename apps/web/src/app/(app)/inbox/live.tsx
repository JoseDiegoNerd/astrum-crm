"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { markConversationRead } from "./actions";

/** Reserva para quando o Realtime cair (rede, aba em segundo plano…). */
const FALLBACK_POLL_MS = 20_000;

/**
 * Mantém o inbox atualizado: escuta mudanças em conversas e mensagens do
 * workspace pelo Supabase Realtime (que aplica a RLS do usuário) e recarrega os
 * dados do servidor. Agrupa rajadas de eventos num único refresh.
 */
export function InboxLive({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const refresh = () => {
      if (pending.current) return;
      pending.current = setTimeout(() => {
        pending.current = null;
        router.refresh();
      }, 300);
    };

    const supabase = createClient();
    const filter = `workspace_id=eq.${workspaceId}`;
    const channel = supabase
      .channel(`inbox:${workspaceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter }, refresh)
      .subscribe();

    const poll = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, FALLBACK_POLL_MS);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      if (pending.current) clearTimeout(pending.current);
      void supabase.removeChannel(channel);
    };
  }, [router, workspaceId]);

  return null;
}

/** Ao abrir uma conversa com não lidas, marca como lida (uma vez por abertura). */
export function MarkRead({ conversationId, unread }: { conversationId: string; unread: number }) {
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (unread > 0 && done.current !== conversationId) {
      done.current = conversationId;
      void markConversationRead(conversationId);
    }
  }, [conversationId, unread]);
  return null;
}

/** Rola até a mensagem mais recente quando a conversa muda ou chega mensagem nova. */
export function ScrollToBottom({ watch, children }: { watch: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [watch]);
  return (
    <div ref={ref} className="flex-1 overflow-y-auto px-4 py-3">
      {children}
    </div>
  );
}
