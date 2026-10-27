import { Suspense } from "react";
import { createTenant } from "@/app/(app)/team/actions";
import { Button, Input, Notice } from "@/components/ui";

export default function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form action={createTenant} className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Crie sua conta</h1>
          <p className="text-sm text-zinc-500">
            A conta reúne seus usuários e o plano. Dentro dela você organiza workspaces — marcas,
            filiais ou clientes.
          </p>
        </div>
        <Suspense>
          <ErrorMessage searchParams={searchParams} />
        </Suspense>
        <label className="block space-y-1 text-sm">
          <span>Nome da empresa</span>
          <Input name="name" required maxLength={120} placeholder="Ex.: Agência Astrum" />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Primeiro workspace</span>
          <Input name="workspaceName" maxLength={120} placeholder="Principal" />
        </label>
        <Button>Criar conta</Button>
      </form>
    </main>
  );
}

async function ErrorMessage({ searchParams }: Pick<PageProps<"/onboarding">, "searchParams">) {
  const { error } = await searchParams;
  return typeof error === "string" ? <Notice tone="error">{error}</Notice> : null;
}
