import type { ContactType, IdentityChannel, LgpdStatus } from "@/lib/api";

export const CONTACT_TYPES: Record<ContactType, string> = {
  lead: "Lead",
  customer: "Cliente",
  other: "Outro",
};

export const CHANNELS: Record<IdentityChannel, string> = {
  whatsapp: "WhatsApp",
  phone: "Telefone",
  email: "E-mail",
  instagram: "Instagram",
  messenger: "Messenger",
  telegram: "Telegram",
  other: "Outro",
};

export const LGPD: Record<LgpdStatus, string> = {
  unknown: "Não informado",
  consented: "Consentiu",
  opted_out: "Pediu para não ser contatado",
};

/** "+5511999990000" → "+55 11 99999-0000" (só para exibição). */
export function formatIdentifier(channel: IdentityChannel, identifier: string) {
  if ((channel === "phone" || channel === "whatsapp") && identifier.startsWith("+55")) {
    const n = identifier.slice(3);
    return `+55 ${n.slice(0, 2)} ${n.slice(2, -4)}-${n.slice(-4)}`;
  }
  if (channel === "instagram" || channel === "telegram") return `@${identifier}`;
  return identifier;
}

export function formatCnpj(digits: string) {
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}
