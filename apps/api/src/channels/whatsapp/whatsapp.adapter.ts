import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MessageType } from '@astrum/db';
import {
  ChannelSendError,
  type ChannelAdapter,
  type ChannelSecrets,
  type ConnectionInfo,
  type DeliveryStatus,
  type InboundMessage,
  type MessageTemplate,
  type NormalizedEvent,
  type OutboundMessage,
  type SendCapabilities,
  type StatusUpdate,
} from '../channel-adapter.js';
import { waIdToE164 } from '../phone.js';

/** Janela de atendimento do WhatsApp: texto livre até 24 h após a última mensagem do contato. */
export const WHATSAPP_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

const MEDIA_TYPES = new Set(['image', 'audio', 'video', 'document', 'sticker']);

// Formato dos webhooks: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks
interface WebhookPayload {
  object?: string;
  entry?: {
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: WaMessage[];
        statuses?: WaStatus[];
      };
    }[];
  }[];
}

interface WaMedia {
  id?: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
  voice?: boolean;
}

interface WaMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  context?: { id?: string };
  text?: { body?: string };
  image?: WaMedia;
  audio?: WaMedia;
  video?: WaMedia;
  document?: WaMedia;
  sticker?: WaMedia;
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  button?: { text?: string; payload?: string };
  [key: string]: unknown;
}

interface WaStatus {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
}

export interface WhatsAppAdapterOptions {
  /** Versão da Graph API (ex.: "v24.0"). Confira a vigente no painel do app. */
  graphVersion: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class WhatsAppCloudAdapter implements ChannelAdapter {
  readonly type = 'whatsapp' as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: WhatsAppAdapterOptions) {
    this.baseUrl = options.baseUrl ?? 'https://graph.facebook.com';
    this.fetchImpl = options.fetch ?? fetch;
  }

  /**
   * Verificação do webhook (GET): devolve o hub.challenge se o token confere.
   * O token é o "Verify Token" cadastrado no painel do app para este canal.
   */
  static verifyChallenge(query: Record<string, unknown>, expectedToken: string): string | null {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    if (mode !== 'subscribe' || typeof token !== 'string' || typeof challenge !== 'string') return null;
    return safeEqual(token, expectedToken) ? challenge : null;
  }

  /** X-Hub-Signature-256: "sha256=" + HMAC-SHA256(corpo bruto, App Secret) em hexadecimal. */
  verifySignature(rawBody: Buffer, signatureHeader: string | undefined, secrets: ChannelSecrets): boolean {
    const appSecret = secrets.appSecret;
    if (!appSecret || !signatureHeader?.startsWith('sha256=')) return false;
    const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
    return safeEqual(signatureHeader.slice('sha256='.length), expected);
  }

  parseWebhook(payload: unknown): NormalizedEvent[] {
    const body = payload as WebhookPayload;
    if (body?.object !== 'whatsapp_business_account') return [];
    const events: NormalizedEvent[] = [];

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages' || !change.value) continue;
        const channelExternalId = change.value.metadata?.phone_number_id;
        if (!channelExternalId) continue;
        const names = new Map((change.value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));

        for (const message of change.value.messages ?? []) {
          const parsed = parseMessage(message, channelExternalId, names.get(message.from));
          if (parsed) events.push(parsed);
        }
        for (const status of change.value.statuses ?? []) {
          const parsed = parseStatus(status, channelExternalId);
          if (parsed) events.push(parsed);
        }
      }
    }
    return events;
  }

  async send(phoneNumberId: string, secrets: ChannelSecrets, message: OutboundMessage) {
    if (!secrets.accessToken) {
      throw new ChannelSendError('Canal sem token de acesso', { retryable: false });
    }
    const response = await this.fetchImpl(
      `${this.baseUrl}/${this.options.graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${secrets.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(buildSendBody(message)),
      },
    );
    const json = (await response.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
      error?: { message?: string; code?: number };
    };

    if (!response.ok || json.error) {
      const code = json.error?.code;
      throw new ChannelSendError(json.error?.message ?? `WhatsApp respondeu ${response.status}`, {
        status: response.status,
        code,
        // limite de taxa e erros do servidor da Meta valem nova tentativa
        retryable: response.status === 429 || response.status >= 500 || code === 130429 || code === 131000,
      });
    }
    const externalId = json.messages?.[0]?.id;
    if (!externalId) throw new ChannelSendError('WhatsApp não devolveu o id da mensagem', { retryable: false });
    return { externalId };
  }

  /** GET /{phone_number_id}: confere o token e devolve o número e o nome verificado. */
  async checkConnection(phoneNumberId: string, secrets: ChannelSecrets): Promise<ConnectionInfo> {
    const json = await this.graphGet<{ display_phone_number?: string; verified_name?: string }>(
      `${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`,
      secrets,
    );
    if (!json.display_phone_number) throw new ChannelSendError('A Meta não reconheceu este número', { retryable: false });
    return { displayIdentifier: json.display_phone_number, verifiedName: json.verified_name };
  }

  /** GET /{waba_id}/message_templates: só os aprovados, com quantos parâmetros cada um espera. */
  async listTemplates(wabaId: string, secrets: ChannelSecrets): Promise<MessageTemplate[]> {
    const json = await this.graphGet<{
      data?: { name: string; language: string; status: string; category?: string; components?: { type: string; text?: string }[] }[];
    }>(`${encodeURIComponent(wabaId)}/message_templates?fields=name,language,status,category,components&limit=200`, secrets);
    return (json.data ?? [])
      .filter((template) => template.status === 'APPROVED')
      .map((template) => {
        const body = template.components?.find((c) => c.type === 'BODY')?.text;
        return {
          name: template.name,
          language: template.language,
          category: template.category,
          body,
          parameterCount: new Set(body?.match(/\{\{\d+\}\}/g) ?? []).size,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language));
  }

  private async graphGet<T>(path: string, secrets: ChannelSecrets): Promise<T> {
    if (!secrets.accessToken) throw new ChannelSendError('Canal sem token de acesso', { retryable: false });
    const response = await this.fetchImpl(`${this.baseUrl}/${this.options.graphVersion}/${path}`, {
      headers: { authorization: `Bearer ${secrets.accessToken}` },
    });
    const json = (await response.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
    if (!response.ok || json.error) {
      throw new ChannelSendError(json.error?.message ?? `A Meta respondeu ${response.status}`, {
        status: response.status,
        code: json.error?.code,
        retryable: response.status >= 500,
      });
    }
    return json;
  }

  capabilities(conversation: { lastInboundAt: Date | null }, now = new Date()): SendCapabilities {
    const last = conversation.lastInboundAt?.getTime();
    if (last !== undefined && now.getTime() - last < WHATSAPP_SERVICE_WINDOW_MS) return { freeText: true };
    return {
      freeText: false,
      reason:
        last === undefined
          ? 'O contato ainda não mandou mensagem: no WhatsApp, a primeira mensagem precisa ser um template aprovado'
          : 'Passaram 24 h desde a última mensagem do contato: no WhatsApp, só templates aprovados até ele responder',
    };
  }
}

function parseMessage(message: WaMessage, channelExternalId: string, profileName?: string): InboundMessage | null {
  if (!message.id || !message.from || !message.type) return null;
  // reações não viram mensagem na conversa (F2)
  if (message.type === 'reaction') return null;

  const base = {
    kind: 'message' as const,
    channelExternalId,
    externalId: message.id,
    from: waIdToE164(message.from),
    profileName: profileName || undefined,
    at: fromUnix(message.timestamp),
    replyToExternalId: message.context?.id,
  };
  const make = (type: MessageType, body: string | undefined, content: Record<string, unknown>): InboundMessage => ({
    ...base,
    type,
    body,
    content,
  });

  if (message.type === 'text') return make('text', message.text?.body ?? '', {});

  if (MEDIA_TYPES.has(message.type)) {
    const media = (message[message.type] ?? {}) as WaMedia;
    return make(message.type as MessageType, media.caption ?? media.filename, {
      mediaId: media.id,
      mimeType: media.mime_type,
      sha256: media.sha256,
      ...(media.filename && { filename: media.filename }),
      ...(media.voice !== undefined && { voice: media.voice }),
    });
  }

  if (message.type === 'location') {
    const loc = message.location ?? {};
    return make('location', [loc.name, loc.address].filter(Boolean).join(' — ') || undefined, {
      latitude: loc.latitude,
      longitude: loc.longitude,
      name: loc.name,
      address: loc.address,
    });
  }

  if (message.type === 'interactive') {
    const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
    return make('interactive', reply?.title, { replyId: reply?.id, kind: message.interactive?.type });
  }

  if (message.type === 'button') {
    return make('interactive', message.button?.text, { payload: message.button?.payload, kind: 'template_button' });
  }

  // tipos ainda não tratados: guarda o original para não perder nada
  return make('unsupported', undefined, { originalType: message.type, raw: message });
}

const STATUSES = new Set<DeliveryStatus>(['sent', 'delivered', 'read', 'failed']);

function parseStatus(status: WaStatus, channelExternalId: string): StatusUpdate | null {
  if (!status.id || !STATUSES.has(status.status as DeliveryStatus)) return null;
  const error = status.errors?.[0];
  return {
    kind: 'status',
    channelExternalId,
    externalId: status.id,
    status: status.status as DeliveryStatus,
    at: fromUnix(status.timestamp),
    recipient: status.recipient_id ? waIdToE164(status.recipient_id) : undefined,
    ...(error && {
      error: { code: error.code, title: error.title ?? error.message, detail: error.error_data?.details },
    }),
  };
}

function buildSendBody(message: OutboundMessage) {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: message.to.replace(/\D/g, '') };
  if (message.type === 'text') {
    return {
      ...base,
      type: 'text',
      text: { preview_url: false, body: message.body },
      ...(message.replyToExternalId && { context: { message_id: message.replyToExternalId } }),
    };
  }
  const { name, language, parameters } = message.template;
  return {
    ...base,
    type: 'template',
    template: {
      name,
      language: { code: language },
      ...(parameters?.length && {
        components: [{ type: 'body', parameters: parameters.map((text) => ({ type: 'text', text })) }],
      }),
    },
  };
}

function fromUnix(timestamp: string | undefined): Date {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
