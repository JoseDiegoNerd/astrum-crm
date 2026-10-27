import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose';
import type { JwtClaims } from '@astrum/db';

/**
 * Valida access tokens emitidos pelo Supabase Auth.
 * - Chaves assimétricas (ES256/RS256): via JWKS público do projeto.
 * - HS256: via segredo legado (útil no CLI local), se configurado.
 */
export class SupabaseJwtVerifier {
  private readonly issuer: string;
  private readonly secret?: Uint8Array;

  constructor(
    supabaseUrl: string,
    jwtSecret?: string,
    private readonly jwks: JWTVerifyGetKey = createRemoteJWKSet(
      new URL(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`),
    ),
  ) {
    this.issuer = `${supabaseUrl.replace(/\/$/, '')}/auth/v1`;
    this.secret = jwtSecret ? new TextEncoder().encode(jwtSecret) : undefined;
  }

  async verify(token: string): Promise<JwtClaims> {
    const { alg } = decodeProtectedHeader(token);
    const options = { issuer: this.issuer, audience: 'authenticated' };

    let payload;
    if (alg === 'HS256') {
      if (!this.secret) throw new Error('Token HS256 recebido sem SUPABASE_JWT_SECRET configurado');
      ({ payload } = await jwtVerify(token, this.secret, { ...options, algorithms: ['HS256'] }));
    } else {
      ({ payload } = await jwtVerify(token, this.jwks, { ...options, algorithms: ['ES256', 'RS256'] }));
    }

    if (typeof payload.sub !== 'string' || payload.role !== 'authenticated') {
      throw new Error('Token sem usuário autenticado');
    }
    if (payload.is_anonymous === true) {
      throw new Error('Login anônimo não é aceito');
    }
    return payload as JwtClaims;
  }
}
