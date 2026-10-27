function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Variável de ambiente ausente: ${name}`);
  return value;
}

// Referências literais a process.env.NEXT_PUBLIC_* para o Next embutir os valores.
export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabasePublishableKey() {
    return required(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
  },
  get apiUrl() {
    return required("NEXT_PUBLIC_API_URL", process.env.NEXT_PUBLIC_API_URL);
  },
};
