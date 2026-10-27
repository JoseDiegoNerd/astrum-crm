import { Suspense } from "react";
import { Button, Input, Notice } from "@/components/ui";
import { signIn, signUp } from "./actions";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Astrum</h1>
          <p className="text-sm text-zinc-500">Entre ou crie sua conta</p>
        </div>
        <Suspense>
          <Messages searchParams={searchParams} />
        </Suspense>
        <form className="space-y-3">
          <Input name="name" placeholder="Seu nome (só no cadastro)" autoComplete="name" />
          <Input name="email" type="email" placeholder="E-mail" required autoComplete="email" />
          <Input
            name="password"
            type="password"
            placeholder="Senha"
            required
            minLength={8}
            autoComplete="current-password"
          />
          <div className="flex gap-2">
            <Button formAction={signIn}>Entrar</Button>
            <Button formAction={signUp} variant="ghost">
              Criar conta
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}

async function Messages({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { error, info } = await searchParams;
  return (
    <>
      {typeof error === "string" && <Notice tone="error">{error}</Notice>}
      {typeof info === "string" && <Notice tone="info">{info}</Notice>}
    </>
  );
}
