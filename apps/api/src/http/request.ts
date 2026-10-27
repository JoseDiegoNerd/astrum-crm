import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { JwtClaims } from '@astrum/db';

export interface WorkspaceContext {
  id: string;
  tenantId: string;
}

export interface AppRequest extends Request {
  user?: JwtClaims;
  workspace?: WorkspaceContext;
}

/** Claims do usuário autenticado (preenchidas pelo AuthGuard). */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): JwtClaims => {
    const user = ctx.switchToHttp().getRequest<AppRequest>().user;
    if (!user) throw new Error('CurrentUser usado em rota pública');
    return user;
  },
);

/** Workspace do header X-Workspace-Id (preenchido pelo WorkspaceGuard). */
export const CurrentWorkspace = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): WorkspaceContext => {
    const workspace = ctx.switchToHttp().getRequest<AppRequest>().workspace;
    if (!workspace) throw new Error('CurrentWorkspace usado sem WorkspaceGuard');
    return workspace;
  },
);
