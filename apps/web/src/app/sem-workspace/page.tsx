import { signOut } from "@/app/login/actions";
import { Button, Notice } from "@/components/ui";

export default function NoWorkspacePage() {
  return (
    <main className="mx-auto w-full max-w-md space-y-4 p-6">
      <Notice tone="info">
        Você faz parte de uma conta, mas ainda não foi incluído em nenhum workspace. Peça ao administrador da conta
        para adicionar você.
      </Notice>
      <form action={signOut}>
        <Button variant="ghost">Sair</Button>
      </form>
    </main>
  );
}
