"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Notice } from "@/components/ui";
import { importContacts, type ImportState } from "./actions";

const COLUMN_LABELS: Record<string, string> = {
  name: "Nome",
  whatsapp: "WhatsApp",
  phone: "Telefone",
  email: "E-mail",
  instagram: "Instagram",
  company: "Empresa",
  type: "Tipo",
  tags: "Tags",
};

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importContacts, {});
  const report = state.report;

  return (
    <div className="space-y-6">
      <form action={action} className="space-y-4">
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-4 file:py-2 file:text-white"
        />
        <fieldset className="space-y-1 text-sm">
          <legend className="mb-1 font-medium">Se o telefone, e-mail ou @ já for de um contato:</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" value="skip" defaultChecked /> pular a linha
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" value="merge" /> completar o contato existente (canais, empresa e tags que faltam)
          </label>
        </fieldset>
        <Button disabled={pending}>{pending ? "Importando… (pode levar alguns segundos)" : "Importar"}</Button>
      </form>

      {state.error && <Notice tone="error">{state.error}</Notice>}

      {report && (
        <section className="space-y-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800" aria-live="polite">
          <h2 className="font-medium">Resultado · {state.fileName}</h2>
          <dl className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
            {[
              ["Linhas", report.total, ""],
              ["Criados", report.created, "text-emerald-600"],
              ["Completados", report.updated, "text-indigo-600"],
              ["Pulados", report.skipped, "text-zinc-500"],
            ].map(([label, value, color]) => (
              <div key={label as string} className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                <dd className={`text-2xl font-semibold ${color}`}>{value}</dd>
                <dt className="text-xs text-zinc-500">{label}</dt>
              </div>
            ))}
          </dl>

          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Colunas reconhecidas:{" "}
            {Object.entries(report.columns)
              .map(([key, header]) => `${header} → ${COLUMN_LABELS[key] ?? key}`)
              .join(" · ")}
            {report.ignoredColumns.length > 0 && <> · ignoradas: {report.ignoredColumns.join(", ")}</>}
          </p>

          {report.warnings.map((warning) => (
            <Notice key={warning} tone="info">
              {warning}
            </Notice>
          ))}

          {report.errors.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-medium text-red-600">Linhas com erro ({report.errors.length})</h3>
              <ul className="max-h-64 overflow-y-auto text-sm">
                {report.errors.map((e) => (
                  <li key={e.line} className="border-b border-zinc-100 py-1 dark:border-zinc-800">
                    <span className="mr-2 font-mono text-xs text-zinc-500">linha {e.line}</span>
                    {e.message}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-zinc-500">Corrija só essas linhas no arquivo e importe de novo — as que já entraram serão puladas.</p>
            </div>
          )}

          <Link href="/contacts" className="inline-block text-sm text-indigo-600 hover:underline">
            Ver contatos →
          </Link>
        </section>
      )}
    </div>
  );
}
