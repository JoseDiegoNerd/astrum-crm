import { createHmac } from 'node:crypto';
import { ChannelSendError } from '../channel-adapter.js';
import { WhatsAppCloudAdapter } from './whatsapp.adapter.js';

// Payloads no formato da documentação da Meta (webhooks da WhatsApp Cloud API).
const PHONE_NUMBER_ID = '106540352242922';
const envelope = (value: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '102290129340398',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550783881', phone_number_id: PHONE_NUMBER_ID },
            ...value,
          },
        },
      ],
    },
  ],
});
const contacts = [{ profile: { name: 'Sheena Nelson' }, wa_id: '5511999990000' }];
const msg = (fields: Record<string, unknown>) => ({
  from: '5511999990000',
  id: 'wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=',
  timestamp: '1749416383',
  ...fields,
});

describe('WhatsAppCloudAdapter', () => {
  const adapter = new WhatsAppCloudAdapter({ graphVersion: 'v24.0' });

  describe('assinatura e verificação do webhook', () => {
    const body = Buffer.from(JSON.stringify(envelope({ messages: [] })));
    const sign = (secret: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

    it('aceita assinatura feita com o App Secret do canal', () => {
      expect(adapter.verifySignature(body, sign('app-secret'), { appSecret: 'app-secret' })).toBe(true);
    });

    it('recusa assinatura de outro segredo, corpo alterado, cabeçalho ausente ou canal sem segredo', () => {
      expect(adapter.verifySignature(body, sign('outro'), { appSecret: 'app-secret' })).toBe(false);
      expect(adapter.verifySignature(Buffer.from(`${body} `), sign('app-secret'), { appSecret: 'app-secret' })).toBe(false);
      expect(adapter.verifySignature(body, undefined, { appSecret: 'app-secret' })).toBe(false);
      expect(adapter.verifySignature(body, sign('app-secret'), {})).toBe(false);
    });

    it('responde o hub.challenge só com o verify token certo', () => {
      const query = { 'hub.mode': 'subscribe', 'hub.verify_token': 'token-do-canal', 'hub.challenge': '1158201444' };
      expect(WhatsAppCloudAdapter.verifyChallenge(query, 'token-do-canal')).toBe('1158201444');
      expect(WhatsAppCloudAdapter.verifyChallenge(query, 'outro')).toBeNull();
      expect(WhatsAppCloudAdapter.verifyChallenge({ ...query, 'hub.mode': 'unsubscribe' }, 'token-do-canal')).toBeNull();
    });
  });

  describe('mensagens recebidas', () => {
    it('texto: normaliza o remetente para E.164 e guarda o nome do perfil', () => {
      const [event] = adapter.parseWebhook(
        envelope({ contacts, messages: [msg({ type: 'text', text: { body: 'Tem em outra cor?' } })] }),
      );
      expect(event).toEqual({
        kind: 'message',
        channelExternalId: PHONE_NUMBER_ID,
        externalId: 'wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=',
        from: '+5511999990000',
        profileName: 'Sheena Nelson',
        at: new Date(1749416383 * 1000),
        type: 'text',
        body: 'Tem em outra cor?',
        content: {},
        replyToExternalId: undefined,
      });
    });

    it('mídia: guarda id, tipo e legenda; áudio de voz marcado', () => {
      const events = adapter.parseWebhook(
        envelope({
          contacts,
          messages: [
            msg({ id: 'wamid.img', type: 'image', image: { id: '1479537139650973', mime_type: 'image/jpeg', sha256: 'abc', caption: 'Olha esse' } }),
            msg({ id: 'wamid.aud', type: 'audio', audio: { id: '777', mime_type: 'audio/ogg; codecs=opus', voice: true } }),
            msg({ id: 'wamid.doc', type: 'document', document: { id: '888', mime_type: 'application/pdf', filename: 'orcamento.pdf' } }),
          ],
        }),
      );
      expect(events.map((e) => e.kind === 'message' && [e.type, e.body, e.content])).toEqual([
        ['image', 'Olha esse', { mediaId: '1479537139650973', mimeType: 'image/jpeg', sha256: 'abc' }],
        ['audio', undefined, { mediaId: '777', mimeType: 'audio/ogg; codecs=opus', sha256: undefined, voice: true }],
        ['document', 'orcamento.pdf', { mediaId: '888', mimeType: 'application/pdf', sha256: undefined, filename: 'orcamento.pdf' }],
      ]);
    });

    it('localização, resposta de botão/lista e resposta a outra mensagem', () => {
      const events = adapter.parseWebhook(
        envelope({
          contacts,
          messages: [
            msg({ id: 'wamid.loc', type: 'location', location: { latitude: -23.55, longitude: -46.63, name: 'Loja', address: 'Av. Paulista' } }),
            msg({ id: 'wamid.btn', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'sim', title: 'Sim, quero' } } }),
            msg({ id: 'wamid.tpl', type: 'button', button: { text: 'Parar promoções', payload: 'STOP' }, context: { id: 'wamid.original' } }),
          ],
        }),
      );
      expect(events.map((e) => e.kind === 'message' && [e.type, e.body])).toEqual([
        ['location', 'Loja — Av. Paulista'],
        ['interactive', 'Sim, quero'],
        ['interactive', 'Parar promoções'],
      ]);
      expect(events[2]).toMatchObject({ replyToExternalId: 'wamid.original', content: { payload: 'STOP' } });
    });

    it('ignora reações e guarda tipos desconhecidos sem perder o payload', () => {
      const events = adapter.parseWebhook(
        envelope({
          contacts,
          messages: [
            msg({ id: 'wamid.r', type: 'reaction', reaction: { message_id: 'wamid.x', emoji: '👍' } }),
            msg({ id: 'wamid.o', type: 'order', order: { catalog_id: '1' } }),
          ],
        }),
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'unsupported', content: { originalType: 'order' } });
    });

    it('ignora payload que não é do WhatsApp ou de outro campo', () => {
      expect(adapter.parseWebhook({ object: 'page', entry: [] })).toEqual([]);
      expect(adapter.parseWebhook({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'account_update', value: {} }] }] })).toEqual([]);
      expect(adapter.parseWebhook(null)).toEqual([]);
    });
  });

  describe('status de entrega', () => {
    it('entregue, lido e falha com o motivo', () => {
      const events = adapter.parseWebhook(
        envelope({
          statuses: [
            { id: 'wamid.1', status: 'delivered', timestamp: '1750263773', recipient_id: '5511999990000' },
            { id: 'wamid.1', status: 'read', timestamp: '1750263800', recipient_id: '5511999990000' },
            {
              id: 'wamid.2',
              status: 'failed',
              timestamp: '1750263900',
              recipient_id: '5511999990000',
              errors: [{ code: 131047, title: 'Re-engagement message', error_data: { details: 'More than 24 hours have passed' } }],
            },
            { id: 'wamid.3', status: 'deleted', timestamp: '1750263900' },
          ],
        }),
      );
      expect(events.map((e) => e.kind === 'status' && [e.externalId, e.status])).toEqual([
        ['wamid.1', 'delivered'],
        ['wamid.1', 'read'],
        ['wamid.2', 'failed'],
      ]);
      expect(events[2]).toMatchObject({
        recipient: '+5511999990000',
        error: { code: 131047, title: 'Re-engagement message', detail: 'More than 24 hours have passed' },
      });
    });
  });

  describe('envio', () => {
    const fakeFetch = (status: number, json: unknown) => {
      const calls: { url: string; init: RequestInit }[] = [];
      const impl = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
      }) as unknown as typeof fetch;
      return { impl, calls };
    };

    it('texto: chama o endpoint do número com o token e devolve o id', async () => {
      const { impl, calls } = fakeFetch(200, { messaging_product: 'whatsapp', messages: [{ id: 'wamid.novo' }] });
      const sender = new WhatsAppCloudAdapter({ graphVersion: 'v24.0', fetch: impl });
      const result = await sender.send(PHONE_NUMBER_ID, { accessToken: 'EAAG-token' }, {
        type: 'text',
        to: '+55 11 99999-0000',
        body: 'Temos sim!',
        replyToExternalId: 'wamid.pergunta',
      });

      expect(result).toEqual({ externalId: 'wamid.novo' });
      expect(calls[0]!.url).toBe(`https://graph.facebook.com/v24.0/${PHONE_NUMBER_ID}/messages`);
      expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer EAAG-token');
      expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '5511999990000',
        type: 'text',
        text: { preview_url: false, body: 'Temos sim!' },
        context: { message_id: 'wamid.pergunta' },
      });
    });

    it('template com parâmetros', async () => {
      const { impl, calls } = fakeFetch(200, { messages: [{ id: 'wamid.tpl' }] });
      await new WhatsAppCloudAdapter({ graphVersion: 'v24.0', fetch: impl }).send(PHONE_NUMBER_ID, { accessToken: 't' }, {
        type: 'template',
        to: '+5511999990000',
        template: { name: 'retomar_conversa', language: 'pt_BR', parameters: ['Ana'] },
      });
      expect(JSON.parse(calls[0]!.init.body as string).template).toEqual({
        name: 'retomar_conversa',
        language: { code: 'pt_BR' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }] }],
      });
    });

    it('erros: limite de taxa vale nova tentativa; token inválido não', async () => {
      const rateLimited = new WhatsAppCloudAdapter({
        graphVersion: 'v24.0',
        fetch: fakeFetch(429, { error: { message: 'Too many messages', code: 130429 } }).impl,
      });
      await expect(rateLimited.send(PHONE_NUMBER_ID, { accessToken: 't' }, { type: 'text', to: '+5511', body: 'x' }))
        .rejects.toMatchObject({ details: { retryable: true, code: 130429 } });

      const unauthorized = new WhatsAppCloudAdapter({
        graphVersion: 'v24.0',
        fetch: fakeFetch(401, { error: { message: 'Invalid OAuth access token', code: 190 } }).impl,
      });
      const error = await unauthorized
        .send(PHONE_NUMBER_ID, { accessToken: 't' }, { type: 'text', to: '+5511', body: 'x' })
        .catch((e) => e);
      expect(error).toBeInstanceOf(ChannelSendError);
      expect(error).toMatchObject({ message: 'Invalid OAuth access token', details: { retryable: false, status: 401 } });
    });

    it('sem token nem tenta enviar', async () => {
      const { impl, calls } = fakeFetch(200, {});
      await expect(
        new WhatsAppCloudAdapter({ graphVersion: 'v24.0', fetch: impl }).send(PHONE_NUMBER_ID, {}, { type: 'text', to: '+55', body: 'x' }),
      ).rejects.toThrow(/sem token/);
      expect(calls).toHaveLength(0);
    });
  });

  describe('janela de 24 h', () => {
    const now = new Date('2026-11-03T12:00:00Z');
    it('texto livre até 24 h depois da última mensagem do contato', () => {
      expect(adapter.capabilities({ lastInboundAt: new Date('2026-11-02T13:00:00Z') }, now)).toEqual({ freeText: true });
      expect(adapter.capabilities({ lastInboundAt: new Date('2026-11-02T11:59:00Z') }, now)).toMatchObject({ freeText: false });
      expect(adapter.capabilities({ lastInboundAt: null }, now).reason).toMatch(/primeira mensagem/);
    });
  });
});
