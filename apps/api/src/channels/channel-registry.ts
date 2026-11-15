import { Inject, Injectable } from '@nestjs/common';
import type { ChannelType } from '@astrum/db';
import type { ChannelAdapter } from './channel-adapter.js';
import { WhatsAppCloudAdapter } from './whatsapp/whatsapp.adapter.js';

/** Adaptador de cada tipo de canal. Novos canais (F3) entram aqui. */
@Injectable()
export class ChannelRegistry {
  private readonly adapters: Partial<Record<ChannelType, ChannelAdapter>>;

  constructor(@Inject(WhatsAppCloudAdapter) whatsapp: WhatsAppCloudAdapter) {
    this.adapters = { whatsapp };
  }

  get(type: ChannelType): ChannelAdapter {
    const adapter = this.adapters[type];
    if (!adapter) throw new Error(`Canal "${type}" ainda não é suportado`);
    return adapter;
  }
}
