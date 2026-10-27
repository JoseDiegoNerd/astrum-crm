/** 129900 → "R$ 1.299,00" */
export function formatMoney(cents: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}

/**
 * "1.299,90" / "1299.9" / "R$ 1.299" / "1.500" → 129990 / 129990 / 129900 / 150000.
 * Vazio → undefined. A vírgula é o separador decimal quando presente; sem vírgula,
 * pontos em grupos de três dígitos são separadores de milhar (padrão brasileiro).
 */
export function parseMoney(input: string): number | undefined {
  const cleaned = input.replace(/[^\d,.-]/g, "");
  if (!cleaned) return undefined;
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(cleaned)
      ? cleaned.replace(/\./g, "")
      : cleaned;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) throw new Error("Valor inválido");
  return Math.round(value * 100);
}

/** 129900 → "1299,00" (para preencher inputs). */
export function centsToInput(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}
