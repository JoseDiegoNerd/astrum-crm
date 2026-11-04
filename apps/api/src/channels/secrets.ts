import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifra dos segredos dos canais (token de acesso, App Secret…) guardados em
 * channels.credentials_enc. AES-256-GCM com chave da aplicação (CHANNEL_SECRETS_KEY,
 * 32 bytes em base64) — a chave nunca vai para o banco.
 *
 * Formato: versão (1 byte) | iv (12) | tag (16) | texto cifrado.
 */
const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretBox {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) {
      throw new Error('CHANNEL_SECRETS_KEY precisa ter 32 bytes em base64 (gere com: openssl rand -base64 32)');
    }
  }

  seal(value: Record<string, string>): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), encrypted]);
  }

  open(sealed: Buffer): Record<string, string> {
    if (sealed[0] !== VERSION) throw new Error('Formato de segredo desconhecido');
    const iv = sealed.subarray(1, 1 + IV_BYTES);
    const tag = sealed.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(sealed.subarray(1 + IV_BYTES + TAG_BYTES)), decipher.final()]);
    return JSON.parse(plain.toString('utf8')) as Record<string, string>;
  }
}
