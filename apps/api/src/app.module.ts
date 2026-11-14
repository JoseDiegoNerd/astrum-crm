import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard.js';
import { SupabaseJwtVerifier } from './auth/supabase-jwt.verifier.js';
import { ENV, type Env } from './config.js';
import { CompaniesService } from './crm/companies.service.js';
import { ContactsService } from './crm/contacts.service.js';
import { CompaniesController, ContactsController, SettingsController } from './crm/crm.controllers.js';
import { DealsController, PipelinesController } from './crm/deals.controllers.js';
import { DealsService } from './crm/deals.service.js';
import { PipelinesService } from './crm/pipelines.service.js';
import { ImportService } from './crm/import.service.js';
import { NotesService } from './crm/notes.service.js';
import { SettingsService } from './crm/settings.service.js';
import { TasksService } from './crm/tasks.service.js';
import { TimelineService } from './crm/timeline.service.js';
import { NotesController, TasksController, TimelineController } from './crm/work.controllers.js';
import { SecretBox } from './channels/secrets.js';
import { WhatsAppCloudAdapter } from './channels/whatsapp/whatsapp.adapter.js';
import { DatabaseModule } from './database/database.module.js';
import { InboundProcessor } from './inbox/inbound.processor.js';
import { InboundWorker } from './inbox/inbound.worker.js';
import { WhatsAppWebhookController } from './inbox/webhooks.controller.js';
import { HealthController } from './health.controller.js';
import { TenancyController } from './tenancy/tenancy.controller.js';
import { TenancyService } from './tenancy/tenancy.service.js';
import { WorkspaceGuard } from './tenancy/workspace.guard.js';

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [DatabaseModule],
      controllers: [
        HealthController,
        TenancyController,
        ContactsController,
        CompaniesController,
        SettingsController,
        DealsController,
        PipelinesController,
        TasksController,
        NotesController,
        TimelineController,
        WhatsAppWebhookController,
      ],
      providers: [
        { provide: ENV, useValue: env },
        {
          provide: SupabaseJwtVerifier,
          useFactory: () => new SupabaseJwtVerifier(env.SUPABASE_URL, env.SUPABASE_JWT_SECRET),
        },
        { provide: APP_GUARD, useClass: AuthGuard },
        TenancyService,
        ContactsService,
        CompaniesService,
        SettingsService,
        DealsService,
        PipelinesService,
        TasksService,
        NotesService,
        TimelineService,
        ImportService,
        // canais (F2): sem CHANNEL_SECRETS_KEY a API sobe, mas webhooks/envio respondem 503
        { provide: SecretBox, useFactory: () => (env.CHANNEL_SECRETS_KEY ? new SecretBox(env.CHANNEL_SECRETS_KEY) : null) },
        { provide: WhatsAppCloudAdapter, useFactory: () => new WhatsAppCloudAdapter({ graphVersion: env.WHATSAPP_GRAPH_VERSION }) },
        InboundProcessor,
        InboundWorker,
        WorkspaceGuard,
      ],
      exports: [ENV],
    };
  }
}
