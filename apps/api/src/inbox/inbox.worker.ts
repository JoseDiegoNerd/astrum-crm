import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ENV, type Env } from '../config.js';
import { InboundProcessor } from './inbound.processor.js';
import { OutboundProcessor } from './outbound.processor.js';

/**
 * Esvazia as filas do inbox — entrada (inbound_events) e saída (messages
 * "queued") — logo após cada webhook/envio (kick) e, de tempos em tempos, para
 * as novas tentativas. Roda no mesmo processo da API por enquanto; vira um
 * processo separado (apps/worker) quando o volume pedir.
 */
@Injectable()
export class InboxWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(InboxWorker.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private again = false;

  constructor(
    @Inject(InboundProcessor) private readonly inbound: InboundProcessor,
    @Inject(OutboundProcessor) private readonly outbound: OutboundProcessor,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap() {
    if (this.env.INBOUND_POLL_MS > 0) {
      this.timer = setInterval(() => this.kick(), this.env.INBOUND_POLL_MS);
      this.timer.unref();
    }
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    await this.running;
  }

  /** Pede uma rodada; se já houver uma em andamento, roda de novo ao terminar. */
  kick() {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.drain().finally(() => {
      this.running = undefined;
      if (this.again) {
        this.again = false;
        this.kick();
      }
    });
  }

  /** Para testes: espera a rodada atual (e as que ela encadear) terminar. */
  async idle() {
    while (this.running) await this.running;
  }

  private async drain() {
    // lotes até as filas esvaziarem (ou só sobrarem itens aguardando nova tentativa)
    for (let round = 0; round < 20; round++) {
      let worked = 0;
      try {
        const inbound = await this.inbound.processPending();
        worked += inbound.processed + inbound.retried + inbound.failed;
      } catch (error) {
        this.logger.error(`Falha na fila de entrada: ${error instanceof Error ? error.message : error}`);
      }
      try {
        const outbound = await this.outbound.processQueued();
        worked += outbound.sent + outbound.retried + outbound.failed;
      } catch (error) {
        this.logger.error(`Falha na fila de saída: ${error instanceof Error ? error.message : error}`);
      }
      if (worked === 0) break;
    }
  }
}
