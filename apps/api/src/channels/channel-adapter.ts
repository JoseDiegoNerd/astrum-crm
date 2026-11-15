import type { ChannelType, MessageType } from '@astrum/db';

/** Mensagem recebida, já no formato do Astrum (independe do provedor). */
export interface InboundMessage {
  kind: 'message';
  /** Conta/número do canal que recebeu (ex.: phone_number_id do WhatsApp). */
  channelExternalId: string;
  externalId: string;
  /** Identificador do contato no canal, normalizado (ex.: "+5511999990000"). */
  from: string;
  /** Nome que o contato usa no canal, se o provedor informar. */
  profileName?: string;
  at: Date;
  type: MessageType;
  /** Texto pesquisável (corpo, legenda, título do botão…). */
  body?: string;
  /** Detalhes específicos do tipo (id da mídia, coordenadas, payload original quando não suportado). */
  content: Record<string, unknown>;
  /** Mensagem à qual esta responde (id externo). */
  replyToExternalId?: string;
}

export type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

/** Atualização de entrega de uma mensagem enviada. */
export interface StatusUpdate {
  kind: 'status';
  channelExternalId: string;
  externalId: string;
  status: DeliveryStatus;
  at: Date;
  recipient?: string;
  error?: { code?: number; title?: string; detail?: string };
}

export type NormalizedEvent = InboundMessage | StatusUpdate;

export type OutboundMessage =
  | { type: 'text'; to: string; body: string; replyToExternalId?: string }
  | { type: 'template'; to: string; template: { name: string; language: string; parameters?: string[] } };

export interface ChannelSecrets {
  [key: string]: string;
}

/** Resultado do teste de conexão: o que o provedor diz sobre a conta conectada. */
export interface ConnectionInfo {
  /** Ex.: "+55 11 99999-0000" */
  displayIdentifier: string;
  /** Nome verificado da conta no provedor, se houver. */
  verifiedName?: string;
}

/** Template aprovado pelo provedor (WhatsApp exige template fora da janela de 24 h). */
export interface MessageTemplate {
  name: string;
  language: string;
  category?: string;
  /** Quantos parâmetros {{n}} o corpo espera. */
  parameterCount: number;
  /** Texto do corpo, para pré-visualização. */
  body?: string;
}

/** O que o canal permite agora numa conversa (ex.: janela de 24 h do WhatsApp). */
export interface SendCapabilities {
  freeText: boolean;
  reason?: string;
}

/**
 * Contrato de todo canal (WhatsApp, e-mail, Instagram…). Adaptadores são puros:
 * não acessam o banco; recebem o necessário e devolvem dados normalizados.
 */
export interface ChannelAdapter {
  readonly type: ChannelType;
  verifySignature(rawBody: Buffer, signatureHeader: string | undefined, secrets: ChannelSecrets): boolean;
  parseWebhook(payload: unknown): NormalizedEvent[];
  send(externalChannelId: string, secrets: ChannelSecrets, message: OutboundMessage): Promise<{ externalId: string }>;
  capabilities(conversation: { lastInboundAt: Date | null }, now?: Date): SendCapabilities;
  /** Confere credenciais e conta; lança ChannelSendError se algo estiver errado. */
  checkConnection(externalChannelId: string, secrets: ChannelSecrets): Promise<ConnectionInfo>;
  listTemplates(externalAccountId: string, secrets: ChannelSecrets): Promise<MessageTemplate[]>;
}

export class ChannelSendError extends Error {
  constructor(
    message: string,
    readonly details: { status?: number; code?: number; retryable: boolean },
  ) {
    super(message);
  }
}
