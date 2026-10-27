import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard.js';
import { SupabaseJwtVerifier } from './auth/supabase-jwt.verifier.js';
import { ENV, type Env } from './config.js';
import { CompaniesService } from './crm/companies.service.js';
import { ContactsService } from './crm/contacts.service.js';
import { CompaniesController, ContactsController } from './crm/crm.controllers.js';
import { DatabaseModule } from './database/database.module.js';
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
      controllers: [HealthController, TenancyController, ContactsController, CompaniesController],
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
        WorkspaceGuard,
      ],
      exports: [ENV],
    };
  }
}
