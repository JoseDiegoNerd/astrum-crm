import Link from "next/link";
import { Card, Notice } from "@/components/ui";
import { canEdit, requireWorkspace } from "@/lib/session";
import { ImportForm } from "./import-form";

export default async function ImportContactsPage() {
  const current = await requireWorkspace();

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <div>
        <Link href="/contacts" className="text-sm text-zinc-500 hover:underline">
          ← Contatos
        </Link>
        <h1 className="text-xl font-semibold">Importar contatos · {current.workspace.name}</h1>
      </div>

      {canEdit(current) ? (
        <>
          <Card title="Como montar o arquivo">
            <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
              <li>
                Arquivo <strong>.csv</strong> (no Excel: Salvar como → CSV). Separador vírgula ou ponto e vírgula; até 5.000 linhas.
              </li>
              <li>
                Primeira linha com os nomes das colunas. Obrigatória: <strong>Nome</strong>. Opcionais: WhatsApp (ou Celular),
                Telefone, E-mail, Instagram, Empresa, Tipo (Lead, Cliente ou Outro) e Tags (separadas por |).
              </li>
              <li>Telefones podem vir em qualquer formato — “(11) 99999-0000” vira +55 11 99999-0000.</li>
              <li>
                Empresas são criadas automaticamente pelo nome. Tags precisam já existir em{" "}
                <Link href="/settings" className="text-indigo-600 hover:underline">
                  Configurações
                </Link>
                .
              </li>
              <li>Ninguém é duplicado: se o telefone, e-mail ou @ já existir no workspace, a linha é pulada ou completa o contato.</li>
            </ul>
            <a href="/modelo-contatos.csv" download className="mt-3 inline-block text-sm text-indigo-600 hover:underline">
              Baixar planilha modelo
            </a>
          </Card>
          <ImportForm />
        </>
      ) : (
        <Notice tone="info">Seu papel neste workspace é de leitura; peça a um agent ou manager para importar.</Notice>
      )}
    </main>
  );
}
