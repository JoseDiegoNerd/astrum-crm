"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition, type DragEvent } from "react";
import type { BoardColumn, DealSummary } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { moveDeal } from "./actions";

type Columns = BoardColumn[];
type Move = { dealId: string; stageId: string; afterDealId: string | null };

/** Aplica o movimento localmente (otimista) enquanto o servidor confirma. */
function applyMove(columns: Columns, { dealId, stageId, afterDealId }: Move): Columns {
  const deal = columns.flatMap((c) => c.deals).find((d) => d.id === dealId);
  if (!deal) return columns;
  return columns.map((column) => {
    const without = column.deals.filter((d) => d.id !== dealId);
    const leaving = without.length !== column.deals.length && column.id !== stageId;
    if (column.id !== stageId) {
      return leaving
        ? { ...column, deals: without, count: column.count - 1, totalCents: column.totalCents - deal.valueCents }
        : column;
    }
    const index = afterDealId ? without.findIndex((d) => d.id === afterDealId) + 1 : 0;
    const moved: DealSummary = { ...deal, stageId, stageName: column.name };
    const arriving = deal.stageId !== stageId;
    return {
      ...column,
      deals: [...without.slice(0, index), moved, ...without.slice(index)],
      count: column.count + (arriving ? 1 : 0),
      totalCents: column.totalCents + (arriving ? deal.valueCents : 0),
    };
  });
}

export function Kanban({ columns, canMove }: { columns: Columns; canMove: boolean }) {
  const [optimistic, addMove] = useOptimistic(columns, applyMove);
  const [, startTransition] = useTransition();
  const [dragging, setDragging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function drop(event: DragEvent, stageId: string, afterDealId: string | null) {
    event.preventDefault();
    event.stopPropagation();
    const dealId = event.dataTransfer.getData("text/deal-id");
    setDragging(null);
    if (!dealId || dealId === afterDealId) return;
    startTransition(async () => {
      addMove({ dealId, stageId, afterDealId });
      const failure = await moveDeal(dealId, stageId, afterDealId);
      setError(failure);
    });
  }

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {optimistic.map((column) => (
          <section
            key={column.id}
            aria-label={column.name}
            onDragOver={(e) => canMove && e.preventDefault()}
            // soltar no fundo da coluna = abaixo do último card
            onDrop={(e) => drop(e, column.id, column.deals.at(-1)?.id ?? null)}
            className="flex w-72 shrink-0 flex-col rounded-xl bg-zinc-100 p-2 dark:bg-zinc-900"
          >
            <header className="mb-2 px-1">
              <div className="flex items-center justify-between text-sm font-medium">
                <span>
                  {column.name}
                  {column.kind !== "open" && (
                    <span className={column.kind === "won" ? "ml-1 text-emerald-600" : "ml-1 text-red-600"}>
                      {column.kind === "won" ? "✓" : "✕"}
                    </span>
                  )}
                </span>
                <span className="text-xs text-zinc-500">{column.count}</span>
              </div>
              <div className="text-xs text-zinc-500">{formatMoney(column.totalCents)}</div>
            </header>

            <div
              onDragOver={(e) => canMove && e.preventDefault()}
              onDrop={(e) => drop(e, column.id, null)}
              className={`h-2 rounded ${dragging ? "bg-indigo-200 dark:bg-indigo-900" : ""}`}
              aria-hidden
            />
            <ol className="flex min-h-16 flex-col gap-2">
              {column.deals.map((deal) => (
                <li
                  key={deal.id}
                  draggable={canMove}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/deal-id", deal.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(deal.id);
                  }}
                  onDragEnd={() => setDragging(null)}
                  onDragOver={(e) => canMove && e.preventDefault()}
                  // soltar sobre um card = logo abaixo dele
                  onDrop={(e) => drop(e, column.id, deal.id)}
                  className={`rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-950 ${
                    canMove ? "cursor-grab active:cursor-grabbing" : ""
                  } ${dragging === deal.id ? "opacity-50" : ""}`}
                >
                  <Link href={`/deals/${deal.id}`} className="font-medium hover:underline">
                    {deal.title}
                  </Link>
                  <div className="mt-1 text-zinc-600 dark:text-zinc-400">{formatMoney(deal.valueCents, deal.currency)}</div>
                  {(deal.contactName || deal.companyName) && (
                    <div className="mt-1 truncate text-xs text-zinc-500">
                      {[deal.contactName, deal.companyName].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  {deal.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {deal.tags.map((tag) => (
                        <span key={tag.id} className="rounded-full px-2 py-0.5 text-[10px] text-white" style={{ backgroundColor: tag.color }}>
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
