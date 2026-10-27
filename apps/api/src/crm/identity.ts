import type { IdentityChannel } from '@astrum/db';

export class InvalidIdentityError extends Error {}

/**
 * Normaliza o identificador para o formato aceito pelo banco
 * (check contact_identities_identifier_format). Mesma entrada → mesma saída,
 * o que torna a deduplicação por (workspace, canal, identificador) confiável.
 */
export function normalizeIdentity(channel: IdentityChannel, raw: string): string {
  const value = raw.trim();
  switch (channel) {
    case 'phone':
    case 'whatsapp':
      return normalizePhone(value);
    case 'email': {
      const email = value.toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 320) {
        throw new InvalidIdentityError('E-mail inválido');
      }
      return email;
    }
    case 'instagram': {
      const handle = value.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/$/, '').toLowerCase();
      if (!/^[a-z0-9._]{1,30}$/.test(handle)) throw new InvalidIdentityError('Usuário do Instagram inválido');
      return handle;
    }
    case 'telegram': {
      const handle = value.replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, '').toLowerCase();
      if (!/^[a-z0-9_]{5,32}$/.test(handle)) throw new InvalidIdentityError('Usuário do Telegram inválido');
      return handle;
    }
    default:
      if (value.length < 1 || value.length > 320) throw new InvalidIdentityError('Identificador inválido');
      return value;
  }
}

/**
 * Telefone em E.164. Sem DDI, assume Brasil (+55): aceita DDD + 8 ou 9 dígitos.
 * "(11) 99999-0000" → "+5511999990000" · "+1 415 555 0100" → "+14155550100"
 */
export function normalizePhone(raw: string): string {
  const hasPlus = raw.trim().startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (!hasPlus && digits.startsWith('00')) digits = digits.slice(2); // 0055...
  else if (!hasPlus && digits.startsWith('0')) digits = digits.replace(/^0+/, ''); // 011 9...

  let e164: string;
  if (hasPlus || raw.trim().startsWith('00')) {
    e164 = `+${digits}`;
  } else if (digits.length === 10 || digits.length === 11) {
    e164 = `+55${digits}`;
  } else if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    e164 = `+${digits}`;
  } else {
    throw new InvalidIdentityError('Telefone inválido: informe DDD e número, ou o DDI com +');
  }

  if (!/^\+[1-9]\d{7,14}$/.test(e164)) throw new InvalidIdentityError('Telefone inválido');
  return e164;
}
