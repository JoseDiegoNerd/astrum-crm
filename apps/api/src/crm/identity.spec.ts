import { normalizeIdentity, normalizePhone } from './identity.js';

describe('normalizePhone', () => {
  it.each([
    ['(11) 99999-0000', '+5511999990000'],
    ['11 9999-0000', '+551199990000'],
    ['011 99999-0000', '+5511999990000'],
    ['5511999990000', '+5511999990000'],
    ['+55 (21) 98888-7777', '+5521988887777'],
    ['0055 21 98888-7777', '+5521988887777'],
    ['+1 415 555 0100', '+14155550100'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['12345', '9999-0000', 'abc', '+0 11 9999', ''])('recusa %s', (input) => {
    expect(() => normalizePhone(input)).toThrow(/Telefone inválido/);
  });
});

describe('normalizeIdentity', () => {
  it('normaliza e-mail para minúsculas', () => {
    expect(normalizeIdentity('email', '  Ana.Souza@Exemplo.COM ')).toBe('ana.souza@exemplo.com');
    expect(() => normalizeIdentity('email', 'ana@')).toThrow(/E-mail inválido/);
  });

  it('aceita @usuário e URL do Instagram', () => {
    expect(normalizeIdentity('instagram', '@Padaria.Sol')).toBe('padaria.sol');
    expect(normalizeIdentity('instagram', 'https://www.instagram.com/padaria_sol/')).toBe('padaria_sol');
    expect(() => normalizeIdentity('instagram', 'nome com espaço')).toThrow();
  });

  it('WhatsApp usa a mesma regra do telefone', () => {
    expect(normalizeIdentity('whatsapp', '(11) 99999-0000')).toBe('+5511999990000');
  });

  it('Telegram aceita @ e link t.me', () => {
    expect(normalizeIdentity('telegram', 'https://t.me/Astrum_Bot')).toBe('astrum_bot');
  });
});
