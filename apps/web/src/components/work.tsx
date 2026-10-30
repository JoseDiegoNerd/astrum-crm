import Link from "next/link";
import {
  createNote,
  createTask,
  deleteNote,
  deleteTask,
  toggleTask,
  updateNote,
} from "@/app/(app)/tasks/actions";
import { Button, Card, Input, Select } from "@/components/ui";
import type { Note, Task, TaskBucket, TenantMember } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";

/** Vínculo da tarefa/nota com o registro da página (um deles). */
export type Subject = { contactId?: string; dealId?: string; companyId?: string };

const BUCKET_STYLE: Partial<Record<TaskBucket, string>> = {
  overdue: "text-red-600",
  today: "text-amber-600",
};

function SubjectFields({ subject, back }: { subject: Subject; back: string }) {
  return (
    <>
      <input type="hidden" name="back" value={back} />
      {subject.contactId && <input type="hidden" name="contactId" value={subject.contactId} />}
      {subject.dealId && <input type="hidden" name="dealId" value={subject.dealId} />}
      {subject.companyId && <input type="hidden" name="companyId" value={subject.companyId} />}
    </>
  );
}

/** Linha de tarefa: concluir com um clique, prazo colorido por urgência, vínculos. */
export function TaskItem({
  task,
  back,
  timezone,
  editable,
  deletable,
  showLinks = true,
}: {
  task: Task;
  back: string;
  timezone: string;
  editable: boolean;
  deletable: boolean;
  showLinks?: boolean;
}) {
  const done = task.doneAt !== null;
  return (
    <li className="flex items-start gap-3 py-2 text-sm">
      <form action={toggleTask}>
        <input type="hidden" name="id" value={task.id} />
        <input type="hidden" name="done" value={String(!done)} />
        <input type="hidden" name="back" value={back} />
        <button
          disabled={!editable}
          aria-label={done ? "Reabrir tarefa" : "Concluir tarefa"}
          className={`mt-0.5 h-4 w-4 rounded border ${
            done ? "border-emerald-600 bg-emerald-600 text-white" : "border-zinc-400 hover:border-indigo-500"
          } text-[10px] leading-none disabled:opacity-50`}
        >
          {done ? "✓" : ""}
        </button>
      </form>
      <div className="min-w-0 flex-1">
        <div className={done ? "text-zinc-400 line-through" : ""}>{task.title}</div>
        <div className="flex flex-wrap gap-x-3 text-xs text-zinc-500">
          {task.dueAt && (
            <span className={done ? "" : (BUCKET_STYLE[task.bucket] ?? "")}>{formatDateTime(task.dueAt, timezone)}</span>
          )}
          {task.assigneeName && <span>{task.assigneeName}</span>}
          {showLinks && task.contactId && (
            <Link href={`/contacts/${task.contactId}`} className="hover:underline">
              {task.contactName}
            </Link>
          )}
          {showLinks && task.dealId && (
            <Link href={`/deals/${task.dealId}`} className="hover:underline">
              {task.dealTitle}
            </Link>
          )}
          {showLinks && task.companyId && (
            <Link href={`/companies/${task.companyId}`} className="hover:underline">
              {task.companyName}
            </Link>
          )}
        </div>
      </div>
      {deletable && (
        <form action={deleteTask}>
          <input type="hidden" name="id" value={task.id} />
          <input type="hidden" name="back" value={back} />
          <button className="text-xs text-zinc-400 hover:text-red-600" aria-label="Excluir tarefa">
            ✕
          </button>
        </form>
      )}
    </li>
  );
}

/** Formulário de nova tarefa (título, prazo, responsável), já vinculado ao assunto. */
export function TaskForm({
  subject = {},
  back,
  members,
  defaultAssignee,
}: {
  subject?: Subject;
  back: string;
  members: TenantMember[];
  defaultAssignee?: string;
}) {
  return (
    <form action={createTask} className="flex flex-wrap gap-2">
      <SubjectFields subject={subject} back={back} />
      <div className="min-w-48 flex-1">
        <Input name="title" required maxLength={200} placeholder="Nova tarefa" />
      </div>
      <Input name="dueAt" type="datetime-local" aria-label="Prazo" />
      <Select name="assigneeId" defaultValue={defaultAssignee ?? ""} aria-label="Responsável">
        {members
          .filter((m) => m.status === "active")
          .map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name ?? m.email}
            </option>
          ))}
      </Select>
      <Button>Adicionar</Button>
    </form>
  );
}

/** Bloco "Tarefas" das fichas de contato, negócio e empresa. */
export function TasksCard({
  tasks,
  subject,
  back,
  timezone,
  members,
  me,
  editable,
  deletable,
}: {
  tasks: Task[];
  subject: Subject;
  back: string;
  timezone: string;
  members: TenantMember[];
  me?: string;
  editable: boolean;
  deletable: boolean;
}) {
  const open = tasks.filter((t) => !t.doneAt);
  const done = tasks.filter((t) => t.doneAt);
  return (
    <Card title={`Tarefas (${open.length})`}>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {tasks.length === 0 && <li className="py-2 text-sm text-zinc-500">Nenhuma tarefa.</li>}
        {[...open, ...done.slice(0, 5)].map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            back={back}
            timezone={timezone}
            editable={editable}
            deletable={deletable}
            showLinks={false}
          />
        ))}
      </ul>
      {editable && (
        <div className="mt-3">
          <TaskForm subject={subject} back={back} members={members} defaultAssignee={me} />
        </div>
      )}
    </Card>
  );
}

/** Bloco "Notas": histórico de anotações; só o autor edita, manager exclui. */
export function NotesCard({
  notes,
  subject,
  back,
  timezone,
  editable,
  deletable,
}: {
  notes: Note[];
  subject: Subject;
  back: string;
  timezone: string;
  editable: boolean;
  deletable: boolean;
}) {
  return (
    <Card title={`Notas (${notes.length})`}>
      {editable && (
        <form action={createNote} className="mb-4 space-y-2">
          <SubjectFields subject={subject} back={back} />
          <textarea
            name="body"
            required
            maxLength={10000}
            rows={3}
            placeholder="Escreva uma nota…"
            className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700"
          />
          <Button>Salvar nota</Button>
        </form>
      )}
      <ul className="space-y-4">
        {notes.length === 0 && <li className="text-sm text-zinc-500">Nenhuma nota.</li>}
        {notes.map((note) => (
          <li key={note.id} className="text-sm">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">{note.authorName ?? "—"}</span>
              <span>{formatDateTime(note.createdAt, timezone)}</span>
              {note.updatedAt !== note.createdAt && <span>(editada)</span>}
              {deletable && (
                <form action={deleteNote} className="ml-auto">
                  <input type="hidden" name="id" value={note.id} />
                  <input type="hidden" name="back" value={back} />
                  <button className="hover:text-red-600">excluir</button>
                </form>
              )}
            </div>
            {note.mine && editable ? (
              <details>
                <summary className="cursor-pointer list-none whitespace-pre-wrap">{note.body}</summary>
                <form action={updateNote} className="mt-2 space-y-2">
                  <input type="hidden" name="id" value={note.id} />
                  <input type="hidden" name="back" value={back} />
                  <textarea
                    name="body"
                    required
                    maxLength={10000}
                    rows={3}
                    defaultValue={note.body}
                    className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
                  />
                  <Button variant="ghost">Salvar edição</Button>
                </form>
              </details>
            ) : (
              <p className="whitespace-pre-wrap">{note.body}</p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
