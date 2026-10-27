import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, type Database } from '@astrum/db';
import { ENV, type Env } from '../config.js';

export const DATABASE = Symbol('DATABASE');
const DATABASE_CLOSE = Symbol('DATABASE_CLOSE');

@Global()
@Module({
  providers: [
    {
      provide: 'DATABASE_HANDLE',
      inject: [ENV],
      useFactory: (env: Env) => createDatabase(env.DATABASE_URL),
    },
    {
      provide: DATABASE,
      inject: ['DATABASE_HANDLE'],
      useFactory: (handle: ReturnType<typeof createDatabase>) => handle.db,
    },
    {
      provide: DATABASE_CLOSE,
      inject: ['DATABASE_HANDLE'],
      useFactory: (handle: ReturnType<typeof createDatabase>) => handle.close,
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_CLOSE) private readonly close: () => Promise<void>) {}

  async onApplicationShutdown() {
    await this.close();
  }
}

export type { Database };
