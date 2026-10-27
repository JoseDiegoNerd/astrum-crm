import type { ComponentProps, ReactNode } from "react";

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      {children}
    </section>
  );
}

export function Input(props: ComponentProps<"input">) {
  return (
    <input
      {...props}
      className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700"
    />
  );
}

export function Select(props: ComponentProps<"select">) {
  return (
    <select
      {...props}
      className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
    />
  );
}

export function Button({ variant = "primary", ...props }: ComponentProps<"button"> & { variant?: "primary" | "ghost" }) {
  const style =
    variant === "primary"
      ? "bg-indigo-600 text-white hover:bg-indigo-500"
      : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";
  return <button {...props} className={`rounded-lg px-4 py-2 text-sm font-medium transition ${style}`} />;
}

export function Notice({ tone, children }: { tone: "error" | "info"; children: ReactNode }) {
  const style =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
      : "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300";
  return <p className={`rounded-lg border px-3 py-2 text-sm ${style}`}>{children}</p>;
}
