import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import type { Subject } from "@/components/work";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { workspaceApi } from "@/lib/session";

type ActivityType =
  | "contact.created"
  | "company.created"
  | "deal.created"
  | "deal.stage_changed"
  | "deal.won"
  | "deal.lost"
  | "task.created"
  | "task.completed"
  | "note.added";

interface Activity {
  id: string;
  type: ActivityType;
  contactId: string | null;
  dealId: string | null;
  companyId: string | null;
  actorName: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
}

const DOT: Record<ActivityType, string> = {
  "contact.created": "bg-indigo-500",
  "company.created": "bg-indigo-500",
  "deal.created": "bg-sky-500",
  "deal.stage_changed": "bg-sky-500",
  "deal.won": "bg-emerald-500",
  "deal.lost": "bg-red-500",
  "task.created": "bg-zinc-400",
  "task.completed": "bg-emerald-500",
  "note.added": "bg-amber-500",
};

/** Frase do evento em português; o título do negócio vira link quando ele ainda existe. */
function describe(activity: Activity): ReactNode {
  const p = activity.payload as Record<string, string | number | undefined>;
  const deal = activity.dealId ? (
    <Link href={`/deals/${activity.dealId}`} className="font-medium hover:underline">
      {p.title}
    </Link>
  ) : (
    <span className="font-medium">{p.title}</span>
  );
  const value = typeof p.value_cents === "number" && p.value_cents > 0 ? ` · ${formatMoney(p.value_cents, String(p.currency ?? "BRL"))}` : "";

  switch (activity.type) {
    case "contact.created":
      return <>criou o contato <span className="font-medium">{p.name}</span></>;
    case "company.created":
      return <>criou a empresa <span className="font-medium">{p.name}</span></>;
    case "deal.created":
      return <>criou o negócio {deal} em {p.stage}{value}</>;
    case "deal.stage_changed":
      return <>moveu {deal} de {p.from} para {p.to}</>;
    case "deal.won":
      return <>marcou {deal} como <span className="text-emerald-600">ganho</span>{value}</>;
    case "deal.lost":
      return (
        <>
          marcou {deal} como <span className="text-red-600">perdido</span>
          {p.reason ? ` — ${p.reason}` : ""}
        </>
      );
    case "task.created":
      return <>criou a tarefa <span className="font-medium">{p.title}</span></>;
    case "task.completed":
      return <>concluiu a tarefa <span className="font-medium">{p.title}</span></>;
    case "note.added":
      return (
        <>
          escreveu uma nota: <span className="text-zinc-600 dark:text-zinc-400">“{p.excerpt}”</span>
        </>
      );
  }
}

/** Linha do tempo de um contato, negócio ou empresa (busca os próprios dados). */
export async function Timeline({ subject, timezone }: { subject: Subject; timezone: string }) {
  const query = new URLSearchParams({ limit: "50" });
  if (subject.contactId) query.set("contact", subject.contactId);
  if (subject.dealId) query.set("deal", subject.dealId);
  if (subject.companyId) query.set("company", subject.companyId);
  const { items } = await workspaceApi<{ items: Activity[]; nextCursor: string | null }>(`/timeline?${query}`);

  return (
    <Card title="Linha do tempo">
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">Nada registrado ainda.</p>
      ) : (
        <ol className="relative space-y-4 border-l border-zinc-200 pl-5 dark:border-zinc-800">
          {items.map((activity) => (
            <li key={activity.id} className="relative text-sm">
              <span className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ${DOT[activity.type]}`} />
              <div>
                <span className="text-zinc-500">{activity.actorName ?? "Sistema"} </span>
                {describe(activity)}
              </div>
              <time className="text-xs text-zinc-400" dateTime={activity.occurredAt}>
                {formatDateTime(activity.occurredAt, timezone)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
