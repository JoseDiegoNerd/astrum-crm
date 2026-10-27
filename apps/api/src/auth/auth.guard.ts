import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AppRequest } from '../http/request.js';
import { SupabaseJwtVerifier } from './supabase-jwt.verifier.js';

const IS_PUBLIC = 'isPublic';

/** Libera a rota do login (ex.: health check). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Guard global: exige `Authorization: Bearer <access token do Supabase>`. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SupabaseJwtVerifier) private readonly verifier: SupabaseJwtVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AppRequest>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!token) throw new UnauthorizedException('Token ausente');

    try {
      request.user = await this.verifier.verify(token);
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado');
    }
    return true;
  }
}
