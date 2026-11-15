import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { JwtClaims } from '@astrum/db';
import { CurrentUser, CurrentWorkspace, type WorkspaceContext } from '../http/request.js';
import { uuidParam, ZodPipe } from '../http/zod.pipe.js';
import { WorkspaceGuard } from '../tenancy/workspace.guard.js';
import {
  ChannelsService,
  connectWhatsAppSchema,
  updateChannelSchema,
  type ConnectWhatsAppInput,
  type UpdateChannelInput,
} from './channels.service.js';
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
  constructor(@Inject(ChannelsService) private readonly channels: ChannelsService) {}

  /** Canais do workspace, sem segredos, com a URL do webhook de cada um. */
  @Get()
  list(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext) {
    return this.channels.list(user, ws);
  }

  /** Conecta um número de WhatsApp (Cloud API). Devolve o verify token uma única vez. */
  @Post('whatsapp')
  connectWhatsApp(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body(new ZodPipe(connectWhatsAppSchema)) body: ConnectWhatsAppInput,
  ) {
    return this.channels.connectWhatsApp(user, ws, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(updateChannelSchema)) body: UpdateChannelInput,
  ) {
    return this.channels.update(user, ws, id, body);
  }

  @Post(':id/test')
  @HttpCode(200)
  test(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.channels.test(user, ws, id);
  }

  @Post(':id/verify-token')
  @HttpCode(200)
  rotateVerifyToken(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.channels.rotateVerifyToken(user, ws, id);
  }

  @Post(':id/disable')
  @HttpCode(200)
  disable(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.channels.setEnabled(user, ws, id, false);
  }

  @Post(':id/enable')
  @HttpCode(200)
  enable(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.channels.setEnabled(user, ws, id, true);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.channels.remove(user, ws, id);
  }

  /** Templates aprovados na Meta, para responder fora da janela de 24 h. */
  @Get(':id/templates')
  templates(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.channels.templates(user, ws, id);
  }
}
