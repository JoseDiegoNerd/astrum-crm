import { createHash, timingSafeEqual } from 'node:crypto';
import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import { channels, eq, withServiceContext, type Database } from '@astrum/db';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../auth/auth.guard.js';
import { SecretBox } from '../channels/secrets.js';
import { WhatsAppCloudAdapter } from '../channels/whatsapp/whatsapp.adapter.js';
import { DATABASE } from '../database/database.module.js';
import { InboundProcessor } from './inbound.processor.js';
import { InboundWorker } from './inbound.worker.js';

/** O verify token do webhook é guardado só como hash (channels.webhook_secret_hash). */
export function hashVerifyToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

const channelIdSchema = z.uuid();

/**
 * Webhooks públicos dos provedores. Cada canal tem a própria URL
 * (/v1/webhooks/whatsapp/:channelId), cadastrada no painel do app da Meta.
 * Sem login: a autenticidade vem do verify token (GET) e da assinatura (POST).
 */
@Public()
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WhatsAppCloudAdapter) private readonly adapter: WhatsAppCloudAdapter,
    @Inject(InboundProcessor) private readonly processor: InboundProcessor,
    @Inject(InboundWorker) private readonly worker: InboundWorker,
    @Optional() @Inject(SecretBox) private readonly secrets: SecretBox | null,
  ) {}

  /** Verificação feita pela Meta ao cadastrar o webhook: devolve o hub.challenge. */
  @Get(':channelId')
  @Header('content-type', 'text/plain')
  async verify(@Param('channelId') channelId: string, @Query() query: Record<string, unknown>) {
    const channel = await this.loadChannel(channelId);
    const token = query['hub.verify_token'];
    const expected = channel.webhookSecretHash;
    const tokenMatches =
      typeof token === 'string' && expected !== null && safeEqualHex(hashVerifyToken(token), expected);
    const challenge = tokenMatches ? WhatsAppCloudAdapter.verifyChallenge(query, token) : null;
    if (!challenge) throw new ForbiddenException('Verify token inválido');
    return challenge;
  }

  /** Eventos (mensagens e status). Responde rápido; o processamento é assíncrono. */
  @Post(':channelId')
  @HttpCode(200)
  async receive(@Param('channelId') channelId: string, @Req() request: RawBodyRequest<Request>) {
    if (!this.secrets) throw new ServiceUnavailableException('CHANNEL_SECRETS_KEY não configurada');
    const channel = await this.loadChannel(channelId);
    if (!channel.credentialsEnc || !request.rawBody) throw new UnauthorizedException('Assinatura inválida');

    const secrets = this.secrets.open(channel.credentialsEnc);
    if (!this.adapter.verifySignature(request.rawBody, request.header('x-hub-signature-256'), secrets)) {
      throw new UnauthorizedException('Assinatura inválida');
    }

    // só eventos do número deste canal (um app da Meta pode ter vários números)
    const events = this.adapter
      .parseWebhook(request.body)
      .filter((event) => event.channelExternalId === channel.externalId);
    const queued = await this.processor.enqueue(channel, events);
    if (queued > 0) this.worker.kick();
    return { received: events.length, queued };
  }

  private async loadChannel(channelId: string) {
    if (!channelIdSchema.safeParse(channelId).success) throw new NotFoundException();
    const [channel] = await withServiceContext(this.db, (tx) =>
      tx
        .select({
          id: channels.id,
          tenantId: channels.tenantId,
          workspaceId: channels.workspaceId,
          type: channels.type,
          status: channels.status,
          externalId: channels.externalId,
          credentialsEnc: channels.credentialsEnc,
          webhookSecretHash: channels.webhookSecretHash,
        })
        .from(channels)
        .where(eq(channels.id, channelId)),
    );
    if (!channel || channel.type !== 'whatsapp' || channel.status === 'disabled') throw new NotFoundException();
    return channel;
  }
}

function safeEqualHex(a: string, b: string) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
