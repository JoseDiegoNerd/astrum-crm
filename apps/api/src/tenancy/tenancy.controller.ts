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
  UseGuards,
} from '@nestjs/common';
import type { JwtClaims } from '@astrum/db';
import { CurrentUser, CurrentWorkspace, type WorkspaceContext } from '../http/request.js';
import { uuidParam, ZodPipe } from '../http/zod.pipe.js';
import {
  addTenantMemberSchema,
  addWorkspaceMemberSchema,
  createTenantSchema,
  createWorkspaceSchema,
  updateTenantMemberSchema,
  type AddTenantMemberInput,
  type AddWorkspaceMemberInput,
  type CreateTenantInput,
  type CreateWorkspaceInput,
  type UpdateTenantMemberInput,
} from './tenancy.schemas.js';
import { TenancyService } from './tenancy.service.js';
import { WorkspaceGuard } from './workspace.guard.js';

@Controller()
export class TenancyController {
  constructor(@Inject(TenancyService) private readonly tenancy: TenancyService) {}

  /** Perfil, tenants e workspaces acessíveis — usado para montar o seletor de workspace. */
  @Get('me')
  me(@CurrentUser() user: JwtClaims) {
    return this.tenancy.me(user);
  }

  /** Onboarding: cria a conta (tenant) com um workspace inicial. */
  @Post('tenants')
  createTenant(
    @CurrentUser() user: JwtClaims,
    @Body(new ZodPipe(createTenantSchema)) body: CreateTenantInput,
  ) {
    return this.tenancy.createTenant(user, body);
  }

  @Get('tenants/:tenantId/members')
  listTenantMembers(@CurrentUser() user: JwtClaims, @Param('tenantId', uuidParam) tenantId: string) {
    return this.tenancy.listTenantMembers(user, tenantId);
  }

  @Post('tenants/:tenantId/members')
  addTenantMember(
    @CurrentUser() user: JwtClaims,
    @Param('tenantId', uuidParam) tenantId: string,
    @Body(new ZodPipe(addTenantMemberSchema)) body: AddTenantMemberInput,
  ) {
    return this.tenancy.addTenantMember(user, tenantId, body);
  }

  @Patch('tenants/:tenantId/members/:userId')
  updateTenantMember(
    @CurrentUser() user: JwtClaims,
    @Param('tenantId', uuidParam) tenantId: string,
    @Param('userId', uuidParam) userId: string,
    @Body(new ZodPipe(updateTenantMemberSchema)) body: UpdateTenantMemberInput,
  ) {
    return this.tenancy.updateTenantMember(user, tenantId, userId, body);
  }

  @Post('tenants/:tenantId/workspaces')
  createWorkspace(
    @CurrentUser() user: JwtClaims,
    @Param('tenantId', uuidParam) tenantId: string,
    @Body(new ZodPipe(createWorkspaceSchema)) body: CreateWorkspaceInput,
  ) {
    return this.tenancy.createWorkspace(user, tenantId, body);
  }

  // Rotas abaixo atuam no workspace do header X-Workspace-Id

  @Get('workspace/members')
  @UseGuards(WorkspaceGuard)
  listWorkspaceMembers(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext) {
    return this.tenancy.listWorkspaceMembers(user, ws);
  }

  @Post('workspace/members')
  @UseGuards(WorkspaceGuard)
  addWorkspaceMember(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body(new ZodPipe(addWorkspaceMemberSchema)) body: AddWorkspaceMemberInput,
  ) {
    return this.tenancy.addWorkspaceMember(user, ws, body);
  }

  @Delete('workspace/members/:userId')
  @HttpCode(204)
  @UseGuards(WorkspaceGuard)
  removeWorkspaceMember(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('userId', uuidParam) userId: string,
  ) {
    return this.tenancy.removeWorkspaceMember(user, ws, userId);
  }
}
