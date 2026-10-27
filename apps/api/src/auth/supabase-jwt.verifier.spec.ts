import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { SupabaseJwtVerifier } from './supabase-jwt.verifier.js';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const SECRET = 'super-secret-jwt-token-with-at-least-32-characters';

const claims = { sub: '6b1f5c1e-2b7a-4f0e-9a51-0d6f1c2a3b4c', role: 'authenticated' };

async function es256Setup() {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' };
  const verifier = new SupabaseJwtVerifier(SUPABASE_URL, undefined, createLocalJWKSet({ keys: [jwk] }));
  const sign = (payload: Record<string, unknown>, opts: { issuer?: string; audience?: string } = {}) =>
    new SignJWT(payload)
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setIssuer(opts.issuer ?? ISSUER)
      .setAudience(opts.audience ?? 'authenticated')
      .setExpirationTime('5m')
      .sign(privateKey);
  return { verifier, sign };
}

describe('SupabaseJwtVerifier', () => {
  it('aceita token ES256 válido do JWKS', async () => {
    const { verifier, sign } = await es256Setup();
    await expect(verifier.verify(await sign(claims))).resolves.toMatchObject(claims);
  });

  it('rejeita emissor de outro projeto', async () => {
    const { verifier, sign } = await es256Setup();
    await expect(verifier.verify(await sign(claims, { issuer: 'https://outro.supabase.co/auth/v1' })))
      .rejects.toThrow();
  });

  it('rejeita audience diferente de authenticated', async () => {
    const { verifier, sign } = await es256Setup();
    await expect(verifier.verify(await sign(claims, { audience: 'anon' }))).rejects.toThrow();
  });

  it('rejeita token do papel anon e login anônimo', async () => {
    const { verifier, sign } = await es256Setup();
    await expect(verifier.verify(await sign({ ...claims, role: 'anon' }))).rejects.toThrow();
    await expect(verifier.verify(await sign({ ...claims, is_anonymous: true }))).rejects.toThrow(/anônimo/);
  });

  it('aceita HS256 somente com segredo configurado', async () => {
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET));

    const { verifier: withoutSecret } = await es256Setup();
    await expect(withoutSecret.verify(token)).rejects.toThrow(/SUPABASE_JWT_SECRET/);

    const withSecret = new SupabaseJwtVerifier(SUPABASE_URL, SECRET, createLocalJWKSet({ keys: [] }));
    await expect(withSecret.verify(token)).resolves.toMatchObject(claims);
  });

  it('rejeita HS256 assinado com outro segredo', async () => {
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('x'.repeat(40)));
    const verifier = new SupabaseJwtVerifier(SUPABASE_URL, SECRET, createLocalJWKSet({ keys: [] }));
    await expect(verifier.verify(token)).rejects.toThrow();
  });
});
