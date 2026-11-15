import { randomBytes } from 'node:crypto';
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  and,
  asc,
  channelPublicColumns,
  channels,
  eq,
  insertRows,
  withServiceContext,
  withUserContext,
  type Database,
  type JwtClaims,
  type Transaction,
} from '@astrum/db';
import { z } from 'zod';
import { ChannelSendError } from '../channels/channel-adapter.js';
import { ChannelRegistry } from '../channels/channel-registry.js';
import { SecretBox } from '../channels/secrets.js';
import { ENV, type Env } from '../config.js';
import { DATABASE } from '../database/database.module.js';
import type { WorkspaceContext } from '../http/request.js';
import { hashVerifyToken } from './webhooks.controller.js';

const digits = z.string().trim().regex(/^\d{5,30}$/, 'Use só os números do ID (copie do painel da Meta)');
const accessToken = z.string().trim().min(20, 'Token muito curto').max(2000);
const appSecret = z.string().trim().min(16, 'Chave secreta muito curta').max(128);

export const connectWhatsAppSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phoneNumberId: digits,
  wabaId: digits,
  accessToken,
  appSecret,
});

export const updateChannelSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    phoneNumberId: digits.optional(),
    wabaId: digits.optional(),
    accessToken: accessToken.optional(),
    appSecret: appSecret.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nada para alterar');

export type ConnectWhatsAppInput = z.infer<typeof connectWhatsAppSchema>;
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;

/**
 * Conexão e manutenção de canais. Segredos (token, chave secreta do app) entram
 * aqui, são cifrados e nunca voltam em nenhuma resposta. O verify token do
 * webhook é gerado pela API e mostrado UMA vez (guardamos só o hash).
 *
 * Permissão: escrita é de manager (RLS de channels). Operações que precisam
 * ler segredos rodam em contexto de serviço só DEPOIS de a RLS confirmar o
 * acesso do usuário àquele canal.
 */
@Injectable()
export class ChannelsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ChannelRegistry) private readonly registry: ChannelRegistry,
    @Inject(ENV) private readonly env: Env,
    @Optional() @Inject(SecretBox) private readonly secrets: SecretBox | null,
  ) {}

  list(user: JwtClaims, ws: WorkspaceContext) {
    return withUserContext(this.db, user, async (tx) => {
      const rows = await tx
        .select(channelPublicColumns)
        .from(channels)
        .where(eq(channels.workspaceId, ws.id))
        .orderBy(asc(channels.name));
      return rows.map((row) => ({ ...row, webhookUrl: this.webhookUrl(row.id) }));
    });
  }

  async connectWhatsApp(user: JwtClaims, ws: WorkspaceContext, input: ConnectWhatsAppInput) {
    const box = this.requireSecrets();
    const verifyToken = newVerifyToken();
    const id = await withUserContext(this.db, user, async (tx) => {
      const [row] = await insertRows(
        tx,
        channels,
        {
          tenantId: ws.tenantId,
          workspaceId: ws.id,
          type: 'whatsapp',
          name: input.name,
          externalAccountId: input.wabaId,
          externalId: input.phoneNumberId,
          credentialsEnc: box.seal({ accessToken: input.accessToken, appSecret: input.appSecret }),
          webhookSecretHash: hashVerifyToken(verifyToken),
        },
        // RETURNING * exigiria SELECT nas colunas de segredo, que usuários não têm
        { returning: ['id'] },
      );
      return row!.id;
    });
    const channel = await this.test(user, ws, id);
    return { channel, webhook: { url: this.webhookUrl(id), verifyToken } };
  }

  async update(user: JwtClaims, ws: WorkspaceContext, id: string, input: UpdateChannelInput) {
    await this.assertManager(user, ws, id);
    const changesSecrets = input.accessToken !== undefined || input.appSecret !== undefined;
    const credentialsEnc = changesSecrets
      ? this.requireSecrets().seal({ ...(await this.readSecrets(id)), ...pick(input, ['accessToken', 'appSecret']) })
      : undefined;

    await withUserContext(this.db, user, async (tx) => {
      const set = Object.fromEntries(
        Object.entries({
          name: input.name,
          externalId: input.phoneNumberId,
          externalAccountId: input.wabaId,
          credentialsEnc,
        }).filter(([, v]) => v !== undefined),
      );
      const updated = await tx
        .update(channels)
        .set(set)
        .where(and(eq(channels.workspaceId, ws.id), eq(channels.id, id)))
        .returning({ id: channels.id });
      if (updated.length === 0) throw new ForbiddenException('Só managers configuram canais');
    });
    // credenciais ou número novos: confere de novo na Meta
    return changesSecrets || input.phoneNumberId ? this.test(user, ws, id) : this.find(user, ws, id);
  }

  /** Confere token e número no provedor e atualiza o status do canal. */
  async test(user: JwtClaims, ws: WorkspaceContext, id: string) {
    const channel = await this.assertManager(user, ws, id);
    const box = this.requireSecrets();

    const result = await withServiceContext(this.db, async (tx) => {
      const [row] = await tx
        .select({ credentialsEnc: channels.credentialsEnc, externalId: channels.externalId })
        .from(channels)
        .where(eq(channels.id, id));
      try {
        if (!row?.credentialsEnc || !row.externalId) throw new ChannelSendError('Canal sem credenciais', { retryable: false });
        const info = await this.registry.get(channel.type).checkConnection(row.externalId, box.open(row.credentialsEnc));
        return { ok: true as const, info };
      } catch (error) {
        return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
      }
    });

    await withServiceContext(this.db, (tx) =>
      tx
        .update(channels)
        .set(
          result.ok
            ? {
                status: channel.status === 'disabled' ? 'disabled' : 'connected',
                displayIdentifier: result.info.displayIdentifier,
                config: { ...channel.config, verifiedName: result.info.verifiedName },
                lastError: null,
                connectedAt: new Date(),
              }
            : { status: channel.status === 'disabled' ? 'disabled' : 'error', lastError: result.message.slice(0, 500) },
        )
        .where(eq(channels.id, id)),
    );
    return this.find(user, ws, id);
  }

  /** Gera um verify token novo (o anterior para de funcionar). Mostrado uma única vez. */
  async rotateVerifyToken(user: JwtClaims, ws: WorkspaceContext, id: string) {
    const verifyToken = newVerifyToken();
    await withUserContext(this.db, user, async (tx) => {
      const updated = await tx
        .update(channels)
        .set({ webhookSecretHash: hashVerifyToken(verifyToken) })
        .where(and(eq(channels.workspaceId, ws.id), eq(channels.id, id)))
        .returning({ id: channels.id });
      if (updated.length === 0) throw new ForbiddenException('Só managers configuram canais');
    });
    return { url: this.webhookUrl(id), verifyToken };
  }

  /** Desativar para de receber e enviar (webhook responde 404); reativar testa de novo. */
  async setEnabled(user: JwtClaims, ws: WorkspaceContext, id: string, enabled: boolean) {
    await withUserContext(this.db, user, async (tx) => {
      const updated = await tx
        .update(channels)
        .set({ status: enabled ? 'pending' : 'disabled' })
        .where(and(eq(channels.workspaceId, ws.id), eq(channels.id, id)))
        .returning({ id: channels.id });
      if (updated.length === 0) throw new ForbiddenException('Só managers configuram canais');
    });
    return enabled ? this.test(user, ws, id) : this.find(user, ws, id);
  }

  remove(user: JwtClaims, ws: WorkspaceContext, id: string) {
    return withUserContext(this.db, user, async (tx) => {
      await findChannel(tx, ws, id);
      // canal com conversas: a FK bloqueia (23001) → 409 com orientação para desativar
      const deleted = await tx
        .delete(channels)
        .where(and(eq(channels.workspaceId, ws.id), eq(channels.id, id)))
        .returning({ id: channels.id });
      if (deleted.length === 0) throw new ForbiddenException('Só managers configuram canais');
    });
  }

  /** Templates aprovados na Meta (qualquer membro do workspace pode consultar). */
  async templates(user: JwtClaims, ws: WorkspaceContext, id: string) {
    const channel = await this.find(user, ws, id);
    if (!channel.externalAccountId) return [];
    const secrets = await this.readSecrets(id);
    try {
      return await this.registry.get(channel.type).listTemplates(channel.externalAccountId, secrets);
    } catch {
      // sem a lista, o atendente ainda pode digitar o nome do template
      return [];
    }
  }

  async find(user: JwtClaims, ws: WorkspaceContext, id: string) {
    const channel = await withUserContext(this.db, user, (tx) => findChannel(tx, ws, id));
    return { ...channel, webhookUrl: this.webhookUrl(id) };
  }

  /** Confirma (sob RLS) que o usuário é manager do workspace do canal. */
  private async assertManager(user: JwtClaims, ws: WorkspaceContext, id: string) {
    return withUserContext(this.db, user, async (tx) => {
      const channel = await findChannel(tx, ws, id);
      // UPDATE sem efeito: só passa pela política de escrita (manager)
      const probe = await tx
        .update(channels)
        .set({ name: channel.name })
        .where(and(eq(channels.workspaceId, ws.id), eq(channels.id, id)))
        .returning({ id: channels.id });
      if (probe.length === 0) throw new ForbiddenException('Só managers configuram canais');
      return channel;
    });
  }

  private async readSecrets(id: string) {
    const box = this.requireSecrets();
    const [row] = await withServiceContext(this.db, (tx) =>
      tx.select({ credentialsEnc: channels.credentialsEnc }).from(channels).where(eq(channels.id, id)),
    );
    return row?.credentialsEnc ? box.open(row.credentialsEnc) : {};
  }

  private requireSecrets() {
    if (!this.secrets) throw new ServiceUnavailableException('CHANNEL_SECRETS_KEY não configurada na API');
    return this.secrets;
  }

  private webhookUrl(id: string) {
    return `${this.env.PUBLIC_API_URL.replace(/\/$/, '')}/v1/webhooks/whatsapp/${id}`;
  }
}

async function findChannel(tx: Transaction, ws: WorkspaceContext, id: string) {
  const [channel] = await tx
    .select(channelPublicColumns)
    .from(channels)
    .where(and(eq(channels.workspaceId, ws.id), eq(channels.id, id)));
  if (!channel) throw new NotFoundException('Canal não encontrado');
  return channel;
}

/** 32 caracteres aleatórios, seguros para colar no painel da Meta. */
function newVerifyToken() {
  return randomBytes(24).toString('base64url');
}

function pick<T extends object, K extends keyof T>(source: T, keys: K[]) {
  return Object.fromEntries(keys.filter((k) => source[k] !== undefined).map((k) => [k, source[k]])) as Partial<Pick<T, K>>;
}
