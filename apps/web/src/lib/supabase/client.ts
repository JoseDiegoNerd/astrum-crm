import { createBrowserClient } from "@supabase/ssr";

/** Cliente do Supabase no navegador (sessão vinda dos cookies) — usado para o Realtime. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
