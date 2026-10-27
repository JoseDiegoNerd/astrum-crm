/** Valida CNPJ (dígitos verificadores) e devolve só os 14 dígitos. */
export function normalizeCnpj(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return null;

  const checkDigit = (base: string) => {
    const weights = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = [...base].reduce((acc, d, i) => acc + Number(d) * weights[i]!, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const first = checkDigit(digits.slice(0, 12));
  const second = checkDigit(digits.slice(0, 12) + first);
  return digits.endsWith(`${first}${second}`) ? digits : null;
}
