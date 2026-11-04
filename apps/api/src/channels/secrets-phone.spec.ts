import { randomBytes } from 'node:crypto';
import { brazilianMobileVariants, waIdToE164 } from './phone.js';
import { SecretBox } from './secrets.js';

describe('SecretBox', () => {
  const key = randomBytes(32).toString('base64');

  it('cifra e decifra os segredos do canal', () => {
    const box = new SecretBox(key);
    const sealed = box.seal({ accessToken: 'EAAG-token', appSecret: 'shh' });
    expect(sealed.toString('utf8')).not.toContain('EAAG-token');
    expect(box.open(sealed)).toEqual({ accessToken: 'EAAG-token', appSecret: 'shh' });
  });

  it('cada cifra é diferente (IV aleatório)', () => {
    const box = new SecretBox(key);
    expect(box.seal({ a: '1' }).equals(box.seal({ a: '1' }))).toBe(false);
  });

  it('recusa conteúdo adulterado ou chave errada', () => {
    const sealed = new SecretBox(key).seal({ accessToken: 'x' });
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1]! ^= 0xff;
    expect(() => new SecretBox(key).open(tampered)).toThrow();
    expect(() => new SecretBox(randomBytes(32).toString('base64')).open(sealed)).toThrow();
  });

  it('exige chave de 32 bytes', () => {
    expect(() => new SecretBox(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});

describe('telefones do WhatsApp', () => {
  it('wa_id vira E.164', () => {
    expect(waIdToE164('5511999990000')).toBe('+5511999990000');
  });

  it('celular brasileiro: tenta com e sem o 9º dígito', () => {
    expect(brazilianMobileVariants('+5511999990000')).toEqual(['+5511999990000', '+551199990000']);
    expect(brazilianMobileVariants('+551199990000')).toEqual(['+551199990000', '+5511999990000']);
  });

  it('fixo e número estrangeiro ficam como estão', () => {
    expect(brazilianMobileVariants('+551133334444')).toEqual(['+551133334444']);
    expect(brazilianMobileVariants('+14155550100')).toEqual(['+14155550100']);
  });
});
