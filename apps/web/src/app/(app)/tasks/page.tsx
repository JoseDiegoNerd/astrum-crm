import Link from "next/link";
import { TaskForm, TaskItem } from "@/components/work";
import { Card, Notice } from "@/components/ui";
import { api, type Task, type TaskBucket, type TenantMember } from "@/lib/api";
import { canDelete, canEdit, getSession, requireWorkspace, workspaceApi } from "@/lib/session";

const SECTIONS: { bucket: TaskBucket; title: string; empty?: string }[] = [
  { bucket: "overdue", title: "Atrasadas" },
  { bucket: "today", title: "Hoje", empty: "Nada para hoje." },
  { bucket: "week", title: "Próximos 7 dias" },
  { bucket: "later", title: "Depois" },
  { bucket: "none", title: "Sem prazo" },
];

const VIEWS = [
  { key: "mine", label: "Minhas" },
  { key: "team", label: "Toda a equipe" },
  { key: "done", label: "Concluídas" },
] as const;

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const params = await searchParams;
  const view = VIEWS.some((v) => v.key === params.view) ? (params.view as (typeof VIEWS)[number]["key"]) : "mine";
  const error = typeof params.error === "string" ? params.error : undefined;

  const [current, { me }] = await Promise.all([requireWorkspace(), getSession()]);
  const query = new URLSearchParams(
    view === "mine" ? {} : view === "team" ? { assignee: "any" } : { assignee: "any", status: "done", limit: "100" },
  );
  const [tasks, members] = await Promise.all([
    workspaceApi<Task[]>(`/tasks?${query}`),
    api<TenantMember[]>(`/tenants/${current.tenant.id}/members`),
  ]);

  const back = view === "mine" ? "/tasks" : `/tasks?view=${view}`;
  const timezone = current.workspace.timezone;
  const editable = canEdit(current);
  const deletable = canDelete(current);
  const item = (task: Task) => (
    <TaskItem key={task.id} task={task} back={back} timezone={timezone} editable={editable} deletable={deletable} />
  );

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-xl font-semibold">Tarefas</h1>
        <nav className="flex gap-1 rounded-lg bg-zinc-100 p-1 text-sm dark:bg-zinc-900">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={v.key === "mine" ? "/tasks" : `/tasks?view=${v.key}`}
              className={`rounded-md px-3 py-1 ${
                view === v.key ? "bg-white shadow-sm dark:bg-zinc-800" : "text-zinc-600 dark:text-zinc-400"
              }`}
            >
              {v.label}
            </Link>
          ))}
        </nav>
      </div>
      {error && <Notice tone="error">{error}</Notice>}

      {editable && view !== "done" && (
        <Card title="Nova tarefa">
          <TaskForm back={back} members={members} defaultAssignee={me.profile?.id} />
        </Card>
      )}

      {view === "done" ? (
        <Card title={`Concluídas (${tasks.length})`}>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {tasks.length === 0 && <li className="py-2 text-sm text-zinc-500">Nenhuma tarefa concluída.</li>}
            {tasks.map(item)}
          </ul>
        </Card>
      ) : (
        SECTIONS.map(({ bucket, title, empty }) => {
          const inSection = tasks.filter((t) => t.bucket === bucket);
          if (inSection.length === 0 && !empty) return null;
          return (
            <section key={bucket}>
              <h2
                className={`mb-1 text-sm font-semibold ${
                  bucket === "overdue" ? "text-red-600" : bucket === "today" ? "text-amber-600" : ""
                }`}
              >
                {title} <span className="font-normal text-zinc-500">({inSection.length})</span>
              </h2>
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {inSection.length === 0 && <li className="py-2 text-sm text-zinc-500">{empty}</li>}
                {inSection.map(item)}
              </ul>
            </section>
          );
        })
      )}
    </main>
  );
}
