/** "5511999990000" (wa_id do WhatsApp) → "+5511999990000". */
export function waIdToE164(waId: string): string {
  const digits = waId.replace(/\D/g, '');
  return `+${digits}`;
}

/**
 * Variantes de um celular brasileiro com e sem o 9º dígito.
 *
 * O WhatsApp às vezes identifica números antigos sem o "9" inicial do celular
 * (ex.: wa_id 551199990000 para +55 11 99999-0000). Para achar o contato certo,
 * a busca de identidade tenta as duas formas.
 */
export function brazilianMobileVariants(e164: string): string[] {
  const match = /^\+55(\d{2})(9?)(\d{8})$/.exec(e164);
  if (!match) return [e164];
  const [, ddd, nine, rest] = match;
  // só celulares (8 dígitos começando com 6–9) têm a variação do 9
  if (!/^[6-9]/.test(rest!)) return [e164];
  const withNine = `+55${ddd}9${rest}`;
  const withoutNine = `+55${ddd}${rest}`;
  return nine ? [withNine, withoutNine] : [withoutNine, withNine];
}
