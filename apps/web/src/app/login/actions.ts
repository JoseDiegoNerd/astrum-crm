"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function credentials(formData: FormData) {
  return {
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };
}

const back = (message: string) => redirect(`/login?error=${encodeURIComponent(message)}`);

export async function signIn(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(credentials(formData));
  if (error) back("E-mail ou senha inválidos");
  redirect("/");
}

export async function signUp(formData: FormData) {
  const supabase = await createClient();
  const name = String(formData.get("name") ?? "").trim();
  const { data, error } = await supabase.auth.signUp({
    ...credentials(formData),
    // só para exibição; autorização nunca usa user_metadata
    options: { data: { name } },
  });
  if (error) back(error.message);
  if (!data.session) {
    redirect(`/login?info=${encodeURIComponent("Confira seu e-mail para confirmar a conta")}`);
  }
  redirect("/onboarding");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
