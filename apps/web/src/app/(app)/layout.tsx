import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/login/actions";
import { Button, Select } from "@/components/ui";
import { getSession } from "@/lib/session";
import { selectWorkspace } from "./team/actions";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<div className="h-14 border-b border-zinc-200 dark:border-zinc-800" />}>
        <Header />
      </Suspense>
      <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Carregando…</p>}>{children}</Suspense>
    </div>
  );
}

const NAV = [
  { href: "/inbox", label: "Inbox" },
  { href: "/deals", label: "Negócios" },
  { href: "/tasks", label: "Tarefas" },
  { href: "/contacts", label: "Contatos" },
  { href: "/companies", label: "Empresas" },
  { href: "/team", label: "Equipe" },
  { href: "/settings", label: "Configurações" },
] as const;

async function Header() {
  const { me, current } = await getSession();
  if (!current) return null;
  const { tenant, workspace } = current;

  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
      <Link href="/inbox" className="font-semibold">
        Astrum
      </Link>
      <nav className="flex gap-4 text-sm">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} className="text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white">
            {item.label}
          </Link>
        ))}
      </nav>
      <form action={selectWorkspace} className="flex items-center gap-2">
        <Select name="workspaceId" defaultValue={workspace.id} aria-label="Workspace">
          {me.tenants.map((t) => (
            <optgroup key={t.id} label={t.name}>
              {t.workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <Button variant="ghost">Trocar</Button>
      </form>
      <span className="ml-auto text-sm text-zinc-500">
        {me.profile?.name ?? me.profile?.email} · {tenant.name} · {workspace.myRole}
      </span>
      <form action={signOut}>
        <Button variant="ghost">Sair</Button>
      </form>
    </header>
  );
}
