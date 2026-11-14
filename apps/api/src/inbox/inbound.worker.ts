import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ENV, type Env } from '../config.js';
import { InboundProcessor } from './inbound.processor.js';

/**
 * Esvazia a fila de entrada: logo após cada webhook (kick) e, de tempos em
 * tempos, para as novas tentativas. Roda no mesmo processo da API por enquanto;
 * vira um processo separado (apps/worker) quando o volume pedir.
 */
@Injectable()
export class InboundWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(InboundWorker.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private again = false;

  constructor(
    @Inject(InboundProcessor) private readonly processor: InboundProcessor,
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
    try {
      // lotes até a fila esvaziar (ou só sobrarem eventos aguardando nova tentativa)
      for (let round = 0; round < 20; round++) {
        const { processed, retried, failed } = await this.processor.processPending();
        if (processed + retried + failed === 0) break;
      }
    } catch (error) {
      this.logger.error(`Falha ao processar a fila de entrada: ${error instanceof Error ? error.message : error}`);
    }
  }
}
