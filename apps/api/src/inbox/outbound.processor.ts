import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  and,
  asc,
  channels,
  contactIdentities,
  conversations,
  eq,
  executeRows,
  messages,
  sql,
  withServiceContext,
  type Database,
  type Transaction,
} from '@astrum/db';
import { ChannelSendError, type OutboundMessage } from '../channels/channel-adapter.js';
import { ChannelRegistry } from '../channels/channel-registry.js';
import { SecretBox } from '../channels/secrets.js';
import { DATABASE } from '../database/database.module.js';

/** Tentativas de envio antes de marcar a mensagem como falha. */
export const MAX_SEND_ATTEMPTS = 5;

type SendOutcome = 'sent' | 'retried' | 'failed';

/**
 * Fila de saída: mensagens "queued" gravadas pelo atendente (sob RLS) são
 * enviadas aqui, em contexto de serviço, pelo adaptador do canal.
 *
 * O envio acontece com a linha travada (FOR UPDATE SKIP LOCKED): dois workers
 * nunca mandam a mesma mensagem. Se o commit falhar depois do envio, a mensagem
 * pode sair duas vezes — risco aceito por ora (raro e visível ao cliente como
 * duplicada, nunca como perdida).
 */
@Injectable()
export class OutboundProcessor {
  private readonly logger = new Logger(OutboundProcessor.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ChannelRegistry) private readonly registry: ChannelRegistry,
    @Optional() @Inject(SecretBox) private readonly secrets: SecretBox | null,
  ) {}

  async processQueued(limit = 20): Promise<Record<SendOutcome, number>> {
    const result: Record<SendOutcome, number> = { sent: 0, retried: 0, failed: 0 };
    await withServiceContext(this.db, async (tx) => {
      const due = await executeRows<{ id: string }>(
        tx,
        sql`select id from messages
            where status = 'queued' and direction = 'out' and next_attempt_at <= now()
            order by next_attempt_at
            limit ${limit}
            for update skip locked`,
      );
      for (const { id } of due) result[await this.sendOne(tx, id)]++;
    });
    return result;
  }

  private async sendOne(tx: Transaction, messageId: string): Promise<SendOutcome> {
    const [row] = await tx
      .select({
        message: messages,
        channelType: channels.type,
        channelStatus: channels.status,
        channelExternalId: channels.externalId,
        credentialsEnc: channels.credentialsEnc,
        identityId: conversations.identityId,
        contactId: conversations.contactId,
      })
      .from(messages)
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(eq(messages.id, messageId));
    if (!row) return 'failed';
    const { message } = row;

    try {
      if (row.channelStatus === 'disabled') throw permanent('Canal desativado');
      if (!this.secrets) throw retryable('CHANNEL_SECRETS_KEY não configurada na API');
      if (!row.credentialsEnc || !row.channelExternalId) throw permanent('Canal sem credenciais: conecte o canal de novo');

      const to = await recipientOf(tx, row.identityId, row.contactId, message.workspaceId);
      if (!to) throw permanent('O contato não tem WhatsApp cadastrado');

      const outbound = await toOutbound(tx, message, to);
      const adapter = this.registry.get(row.channelType);
      const { externalId } = await adapter.send(row.channelExternalId, this.secrets.open(row.credentialsEnc), outbound);

      await tx
        .update(messages)
        .set({ status: 'sent', externalId, sentAt: new Date(), sendAttempts: message.sendAttempts + 1, error: null })
        .where(eq(messages.id, messageId));
      return 'sent';
    } catch (error) {
      const attempts = message.sendAttempts + 1;
      const canRetry = error instanceof ChannelSendError && error.details.retryable && attempts < MAX_SEND_ATTEMPTS;
      const details =
        error instanceof ChannelSendError
          ? { message: error.message, code: error.details.code, status: error.details.status }
          : { message: error instanceof Error ? error.message : String(error) };

      await tx
        .update(messages)
        .set({
          status: canRetry ? 'queued' : 'failed',
          sendAttempts: attempts,
          error: details,
          // espera crescente: 15 s, 30 s, 60 s, 120 s
          nextAttemptAt: new Date(Date.now() + 15_000 * 2 ** (attempts - 1)),
        })
        .where(eq(messages.id, messageId));
      if (!canRetry) this.logger.warn(`Mensagem ${messageId} não enviada: ${details.message}`);
      return canRetry ? 'retried' : 'failed';
    }
  }
}

const permanent = (message: string) => new ChannelSendError(message, { retryable: false });
const retryable = (message: string) => new ChannelSendError(message, { retryable: true });

/** Número de destino: a identidade da conversa ou, sem ela, o WhatsApp principal do contato. */
async function recipientOf(tx: Transaction, identityId: string | null, contactId: string, workspaceId: string) {
  if (identityId) {
    const [identity] = await tx
      .select({ identifier: contactIdentities.identifier })
      .from(contactIdentities)
      .where(eq(contactIdentities.id, identityId));
    if (identity) return identity.identifier;
  }
  const [fallback] = await tx
    .select({ identifier: contactIdentities.identifier })
    .from(contactIdentities)
    .where(
      and(
        eq(contactIdentities.workspaceId, workspaceId),
        eq(contactIdentities.contactId, contactId),
        eq(contactIdentities.channel, 'whatsapp'),
      ),
    )
    .orderBy(sql`${contactIdentities.isPrimary} desc`, asc(contactIdentities.createdAt))
    .limit(1);
  return fallback?.identifier;
}

async function toOutbound(
  tx: Transaction,
  message: typeof messages.$inferSelect,
  to: string,
): Promise<OutboundMessage> {
  if (message.type === 'template') {
    const template = message.content.template as { name: string; language: string; parameters?: string[] } | undefined;
    if (!template?.name) throw permanent('Template sem nome');
    return { type: 'template', to, template };
  }
  const replyToExternalId = message.replyToId
    ? (await tx.select({ externalId: messages.externalId }).from(messages).where(eq(messages.id, message.replyToId)))[0]
        ?.externalId ?? undefined
    : undefined;
  return { type: 'text', to, body: message.body ?? '', replyToExternalId };
}
