import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  channelPublicColumns,
  channels,
  contacts,
  conversations,
  desc,
  eq,
  inArray,
  insertRows,
  isNull,
  messages,
  profiles,
  sql,
  withUserContext,
  type Database,
  type JwtClaims,
  type SQL,
  type Transaction,
} from '@astrum/db';
import { ChannelRegistry } from '../channels/channel-registry.js';
import { DATABASE } from '../database/database.module.js';
import type { WorkspaceContext } from '../http/request.js';
import { decodeCursor, encodeCursor } from '../crm/pagination.js';
import type {
  ListConversationsInput,
  ListMessagesInput,
  SendMessageInput,
  UpdateConversationInput,
} from './inbox.schemas.js';

/** Data que ordena o inbox: última mensagem (ou criação, se ainda não houver). */
const activityAt = sql<Date>`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`;

/**
 * Inbox do ponto de vista do atendente. Tudo sob RLS (withUserContext); o envio
 * só grava a mensagem "queued" — quem fala com o provedor é o OutboundProcessor.
 */
@Injectable()
export class ConversationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ChannelRegistry) private readonly registry: ChannelRegistry,
  ) {}

  list(user: JwtClaims, ws: WorkspaceContext, input: ListConversationsInput) {
    return withUserContext(this.db, user, async (tx) => {
      const where: SQL[] = [eq(conversations.workspaceId, ws.id)];
      if (input.status === 'active') where.push(inArray(conversations.status, ['open', 'pending']));
      else if (input.status !== 'all') where.push(eq(conversations.status, input.status));
      if (input.assignee === 'me') where.push(eq(conversations.assigneeId, user.sub));
      else if (input.assignee === 'none') where.push(isNull(conversations.assigneeId));
      else if (input.assignee !== 'any') where.push(eq(conversations.assigneeId, input.assignee));
      if (input.channel) where.push(eq(conversations.channelId, input.channel));
      if (input.contact) where.push(eq(conversations.contactId, input.contact));
      if (input.unread) where.push(sql`${conversations.unreadCount} > 0`);
      if (input.q) {
        // mesma busca indexada dos contatos (nome ou número)
        where.push(
          sql`${conversations.contactId} in (select private.search_contact_ids(${ws.id}::uuid, ${input.q}, ${input.q.replace(/^@/, '')}))`,
        );
      }
      if (input.cursor) {
        const cursor = decodeCursor(input.cursor);
        where.push(sql`(${activityAt}, ${conversations.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`);
      }

      const rows = await selectConversations(tx)
        .where(and(...where))
        .orderBy(desc(activityAt), desc(conversations.id))
        .limit(input.limit + 1);
      const items = rows.slice(0, input.limit);
      const last = items.at(-1);
      return {
        items: items.map((row) => this.withCapabilities(row)),
        nextCursor: rows.length > input.limit && last ? encodeCursor({ createdAt: new Date(last.activityAt), id: last.id }) : null,
      };
    });
  }

  get(user: JwtClaims, ws: WorkspaceContext, id: string) {
    return withUserContext(this.db, user, async (tx) => this.withCapabilities(await findConversation(tx, ws, id)));
  }

  update(user: JwtClaims, ws: WorkspaceContext, id: string, input: UpdateConversationInput) {
    return withUserContext(this.db, user, async (tx) => {
      await findConversation(tx, ws, id);
      const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      const updated = await tx
        .update(conversations)
        .set(set)
        .where(and(eq(conversations.workspaceId, ws.id), eq(conversations.id, id)))
        .returning({ id: conversations.id });
      if (updated.length === 0) throw new ForbiddenException('Sem permissão para alterar esta conversa');
      return this.withCapabilities(await findConversation(tx, ws, id));
    });
  }

  /** Zera as não lidas. Viewer pode abrir a conversa, mas não mexe no contador (RLS). */
  markRead(user: JwtClaims, ws: WorkspaceContext, id: string) {
    return withUserContext(this.db, user, async (tx) => {
      await findConversation(tx, ws, id);
      await tx
        .update(conversations)
        .set({ unreadCount: 0 })
        .where(and(eq(conversations.workspaceId, ws.id), eq(conversations.id, id)));
      return this.withCapabilities(await findConversation(tx, ws, id));
    });
  }

  listMessages(user: JwtClaims, ws: WorkspaceContext, conversationId: string, input: ListMessagesInput) {
    return withUserContext(this.db, user, async (tx) => {
      await findConversation(tx, ws, conversationId);
      const where: SQL[] = [eq(messages.workspaceId, ws.id), eq(messages.conversationId, conversationId)];
      if (input.before) {
        const cursor = decodeCursor(input.before);
        where.push(sql`(${messages.createdAt}, ${messages.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`);
      }
      const rows = await tx
        .select({
          id: messages.id,
          direction: messages.direction,
          senderType: messages.senderType,
          senderId: messages.senderId,
          senderName: sql<string | null>`coalesce(${profiles.name}, ${profiles.email})`,
          type: messages.type,
          body: messages.body,
          content: messages.content,
          replyToId: messages.replyToId,
          status: messages.status,
          error: messages.error,
          createdAt: messages.createdAt,
          sentAt: messages.sentAt,
          deliveredAt: messages.deliveredAt,
          readAt: messages.readAt,
        })
        .from(messages)
        .leftJoin(profiles, eq(profiles.id, messages.senderId))
        .where(and(...where))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(input.limit + 1);
      const page = rows.slice(0, input.limit);
      const oldest = page.at(-1);
      return {
        // mais antigas primeiro, como aparecem na tela
        items: page.reverse(),
        previousCursor: rows.length > input.limit && oldest ? encodeCursor({ createdAt: oldest.createdAt, id: oldest.id }) : null,
      };
    });
  }

  /** Grava a mensagem para envio. Texto livre só dentro da janela do canal (24 h no WhatsApp). */
  send(user: JwtClaims, ws: WorkspaceContext, conversationId: string, input: SendMessageInput) {
    return withUserContext(this.db, user, async (tx) => {
      const conversation = this.withCapabilities(await findConversation(tx, ws, conversationId));
      if (conversation.status === 'resolved') {
        throw new ConflictException('Conversa resolvida: reabra a conversa para responder');
      }
      if (input.type === 'text' && !conversation.capabilities.freeText) {
        throw new ConflictException({ message: conversation.capabilities.reason, code: 'TEMPLATE_REQUIRED' });
      }
      if (input.type === 'text' && input.replyToId) {
        const [original] = await tx
          .select({ id: messages.id })
          .from(messages)
          .where(and(eq(messages.id, input.replyToId), eq(messages.conversationId, conversationId)));
        if (!original) throw new NotFoundException('Mensagem citada não está nesta conversa');
      }

      const [message] = await insertRows(tx, messages, {
        tenantId: ws.tenantId,
        workspaceId: ws.id,
        conversationId,
        channelId: conversation.channelId,
        direction: 'out',
        senderType: 'user',
        type: input.type,
        body: input.type === 'text' ? input.body : `Template: ${input.template.name}`,
        content: input.type === 'template' ? { template: input.template } : {},
        replyToId: input.type === 'text' ? input.replyToId : undefined,
      });
      return message!;
    });
  }

  private withCapabilities<T extends { channelType: Parameters<ChannelRegistry['get']>[0]; lastInboundAt: Date | null }>(row: T) {
    return { ...row, capabilities: this.registry.get(row.channelType).capabilities({ lastInboundAt: row.lastInboundAt }) };
  }
}

function selectConversations(tx: Transaction) {
  return tx
    .select({
      id: conversations.id,
      status: conversations.status,
      subject: conversations.subject,
      channelId: conversations.channelId,
      channelName: channelPublicColumns.name,
      channelType: channelPublicColumns.type,
      contactId: conversations.contactId,
      contactName: contacts.name,
      identityId: conversations.identityId,
      assigneeId: conversations.assigneeId,
      assigneeName: sql<string | null>`coalesce(${profiles.name}, ${profiles.email})`,
      unreadCount: conversations.unreadCount,
      lastMessageAt: conversations.lastMessageAt,
      lastInboundAt: conversations.lastInboundAt,
      lastOutboundAt: conversations.lastOutboundAt,
      resolvedAt: conversations.resolvedAt,
      createdAt: conversations.createdAt,
      activityAt,
      // prévia da última mensagem (sob RLS, como o resto)
      lastMessage: sql<{ body: string | null; type: string; direction: string; status: string } | null>`(
        select json_build_object('body', m.body, 'type', m.type, 'direction', m.direction, 'status', m.status)
        from messages m where m.conversation_id = ${conversations.id}
        order by m.created_at desc, m.id desc limit 1)`,
    })
    .from(conversations)
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .leftJoin(profiles, eq(profiles.id, conversations.assigneeId))
    .$dynamic();
}

async function findConversation(tx: Transaction, ws: WorkspaceContext, id: string) {
  const [row] = await selectConversations(tx).where(and(eq(conversations.workspaceId, ws.id), eq(conversations.id, id)));
  if (!row) throw new NotFoundException('Conversa não encontrada');
  return row;
}
