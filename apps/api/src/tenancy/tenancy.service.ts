import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  memberships,
  profiles,
  sql,
  tenants,
  withUserContext,
  workspaceMembers,
  workspaces,
  type Database,
  type JwtClaims,
} from '@astrum/db';
import { DATABASE } from '../database/database.module.js';
import type { WorkspaceContext } from '../http/request.js';
import type {
  AddTenantMemberInput,
  AddWorkspaceMemberInput,
  CreateTenantInput,
  CreateWorkspaceInput,
  UpdateTenantMemberInput,
} from './tenancy.schemas.js';

// Todas as consultas passam por withUserContext: quem decide o que o usuário
// pode ver ou alterar é a RLS do banco, não este serviço.
@Injectable()
export class TenancyService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  me(user: JwtClaims) {
    return withUserContext(this.db, user, async (tx) => {
      const [profile] = await tx.select().from(profiles).where(eq(profiles.id, user.sub));
      const accounts = await tx
        .select({
          tenantId: tenants.id,
          tenantName: tenants.name,
          tenantSlug: tenants.slug,
          role: memberships.role,
        })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(and(eq(memberships.userId, user.sub), eq(memberships.status, 'active')))
        .orderBy(asc(tenants.name));
      const visibleWorkspaces = await tx
        .select()
        .from(workspaces)
        .orderBy(asc(workspaces.name));

      return {
        profile: profile ?? null,
        tenants: accounts.map((a) => ({
          id: a.tenantId,
          name: a.tenantName,
          slug: a.tenantSlug,
          role: a.role,
          workspaces: visibleWorkspaces.filter((w) => w.tenantId === a.tenantId),
        })),
      };
    });
  }

  createTenant(user: JwtClaims, input: CreateTenantInput) {
    return withUserContext(this.db, user, async (tx) => {
      const rows = await tx.execute<{ id: string; name: string; slug: string }>(
        sql`select id, name, slug from private.create_tenant(${input.name}, ${input.workspaceName ?? 'Principal'})`,
      );
      const tenant = rows[0]!;
      const tenantWorkspaces = await tx
        .select()
        .from(workspaces)
        .where(eq(workspaces.tenantId, tenant.id));
      return { ...tenant, workspaces: tenantWorkspaces };
    });
  }

  listTenantMembers(user: JwtClaims, tenantId: string) {
    return withUserContext(this.db, user, (tx) =>
      tx
        .select({
          userId: memberships.userId,
          role: memberships.role,
          status: memberships.status,
          name: profiles.name,
          email: profiles.email,
        })
        .from(memberships)
        .innerJoin(profiles, eq(profiles.id, memberships.userId))
        .where(eq(memberships.tenantId, tenantId))
        .orderBy(asc(profiles.name)),
    );
  }

  addTenantMember(user: JwtClaims, tenantId: string, input: AddTenantMemberInput) {
    return withUserContext(this.db, user, async (tx) => {
      const rows = await tx.execute<{ user_id: string; role: string }>(
        sql`select user_id, role from private.add_tenant_member_by_email(
              ${tenantId}, ${input.email}, ${input.role}::public.tenant_role)`,
      );
      return { userId: rows[0]!.user_id, role: rows[0]!.role };
    });
  }

  updateTenantMember(
    user: JwtClaims,
    tenantId: string,
    memberUserId: string,
    input: UpdateTenantMemberInput,
  ) {
    return withUserContext(this.db, user, async (tx) => {
      const [updated] = await tx
        .update(memberships)
        .set({ ...(input.role && { role: input.role }), ...(input.status && { status: input.status }) })
        .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, memberUserId)))
        .returning({ userId: memberships.userId, role: memberships.role, status: memberships.status });
      if (!updated) throw new NotFoundException('Membro não encontrado ou sem permissão');
      return updated;
    });
  }

  createWorkspace(user: JwtClaims, tenantId: string, input: CreateWorkspaceInput) {
    return withUserContext(this.db, user, async (tx) => {
      const [created] = await tx
        .insert(workspaces)
        .values({ tenantId, name: input.name, timezone: input.timezone, locale: input.locale })
        .returning();
      return created!;
    });
  }

  listWorkspaceMembers(user: JwtClaims, workspace: WorkspaceContext) {
    return withUserContext(this.db, user, (tx) =>
      tx
        .select({
          userId: workspaceMembers.userId,
          role: workspaceMembers.role,
          name: profiles.name,
          email: profiles.email,
        })
        .from(workspaceMembers)
        .innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
        .where(eq(workspaceMembers.workspaceId, workspace.id))
        .orderBy(asc(profiles.name)),
    );
  }

  addWorkspaceMember(user: JwtClaims, workspace: WorkspaceContext, input: AddWorkspaceMemberInput) {
    return withUserContext(this.db, user, async (tx) => {
      const [created] = await tx
        .insert(workspaceMembers)
        .values({
          tenantId: workspace.tenantId,
          workspaceId: workspace.id,
          userId: input.userId,
          role: input.role,
        })
        .returning({ userId: workspaceMembers.userId, role: workspaceMembers.role });
      return created!;
    });
  }

  removeWorkspaceMember(user: JwtClaims, workspace: WorkspaceContext, memberUserId: string) {
    return withUserContext(this.db, user, async (tx) => {
      const removed = await tx
        .delete(workspaceMembers)
        .where(
          and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, memberUserId)),
        )
        .returning({ userId: workspaceMembers.userId });
      if (removed.length === 0) throw new NotFoundException('Membro não encontrado ou sem permissão');
    });
  }
}
