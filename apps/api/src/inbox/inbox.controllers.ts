import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { asc, channelPublicColumns, channels, eq, withUserContext, type Database, type JwtClaims } from '@astrum/db';
import { DATABASE } from '../database/database.module.js';
import { CurrentUser, CurrentWorkspace, type WorkspaceContext } from '../http/request.js';
import { uuidParam, ZodPipe } from '../http/zod.pipe.js';
import { WorkspaceGuard } from '../tenancy/workspace.guard.js';
import { ConversationsService } from './conversations.service.js';
import { InboxWorker } from './inbox.worker.js';
import {
  listConversationsSchema,
  listMessagesSchema,
  sendMessageSchema,
  updateConversationSchema,
  type ListConversationsInput,
  type ListMessagesInput,
  type SendMessageInput,
  type UpdateConversationInput,
} from './inbox.schemas.js';

@Controller('conversations')
@UseGuards(WorkspaceGuard)
export class ConversationsController {
  constructor(
    @Inject(ConversationsService) private readonly conversations: ConversationsService,
    @Inject(InboxWorker) private readonly worker: InboxWorker,
  ) {}

  @Get()
  list(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(new ZodPipe(listConversationsSchema)) query: ListConversationsInput,
  ) {
    return this.conversations.list(user, ws, query);
  }

  @Get(':id')
  get(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.conversations.get(user, ws, id);
  }

  /** Status (aberta/pendente/resolvida), responsável e assunto. */
  @Patch(':id')
  update(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(updateConversationSchema)) body: UpdateConversationInput,
  ) {
    return this.conversations.update(user, ws, id, body);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.conversations.markRead(user, ws, id);
  }

  @Get(':id/messages')
  messages(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', uuidParam) id: string,
    @Query(new ZodPipe(listMessagesSchema)) query: ListMessagesInput,
  ) {
    return this.conversations.listMessages(user, ws, id, query);
  }

  /** Grava a mensagem como "queued" e aciona o envio. Responde antes da Meta. */
  @Post(':id/messages')
  @HttpCode(202)
  async send(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(sendMessageSchema)) body: SendMessageInput,
  ) {
    const message = await this.conversations.send(user, ws, id, body);
    this.worker.kick();
    return message;
  }
}

@Controller('channels')
@UseGuards(WorkspaceGuard)
export class ChannelsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Canais do workspace, sem segredos (usuários não têm acesso a essas colunas). */
  @Get()
  list(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext) {
    return withUserContext(this.db, user, (tx) =>
      tx.select(channelPublicColumns).from(channels).where(eq(channels.workspaceId, ws.id)).orderBy(asc(channels.name)),
    );
  }
}
