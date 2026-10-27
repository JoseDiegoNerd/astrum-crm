import {
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { eq, withUserContext, workspaces, type Database } from '@astrum/db';
import { z } from 'zod';
import { DATABASE } from '../database/database.module.js';
import type { AppRequest } from '../http/request.js';

export const WORKSPACE_HEADER = 'x-workspace-id';

/**
 * Resolve o workspace do header X-Workspace-Id para rotas de workspace.
 * A consulta roda sob RLS: se o usuário não tem acesso, o workspace "não existe".
 * É a primeira barreira; a RLS continua valendo em toda consulta seguinte.
 */
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AppRequest>();
    const parsed = z.uuid().safeParse(request.headers[WORKSPACE_HEADER]);
    if (!parsed.success) throw new BadRequestException('Header X-Workspace-Id ausente ou inválido');
    if (!request.user) return false;

    const [workspace] = await withUserContext(this.db, request.user, (tx) =>
      tx
        .select({ id: workspaces.id, tenantId: workspaces.tenantId })
        .from(workspaces)
        .where(eq(workspaces.id, parsed.data))
        .limit(1),
    );
    if (!workspace) throw new ForbiddenException('Sem acesso a este workspace');

    request.workspace = workspace;
    return true;
  }
}
