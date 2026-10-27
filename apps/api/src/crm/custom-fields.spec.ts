import { BadRequestException } from '@nestjs/common';
import { applyCustomFields, keyFromLabel } from './custom-fields.js';

const defs = [
  { key: 'origem', label: 'Origem', type: 'select' as const, options: ['Site', 'Indicação'], required: true },
  { key: 'interesses', label: 'Interesses', type: 'multiselect' as const, options: ['A', 'B', 'C'], required: false },
  { key: 'faturamento', label: 'Faturamento', type: 'number' as const, options: [], required: false },
  { key: 'nascimento', label: 'Nascimento', type: 'date' as const, options: [], required: false },
  { key: 'newsletter', label: 'Newsletter', type: 'boolean' as const, options: [], required: false },
  { key: 'obs', label: 'Observações', type: 'text' as const, options: [], required: false },
];

const issuesOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return ((error as BadRequestException).getResponse() as { issues: { path: string }[] }).issues.map((i) => i.path);
  }
  throw new Error('era esperado erro de validação');
};

describe('applyCustomFields', () => {
  it('normaliza valores de cada tipo', () => {
    expect(
      applyCustomFields(defs, {
        origem: 'Site',
        interesses: ['A', 'B', 'A'],
        faturamento: '1500,50',
        nascimento: '1990-02-28',
        newsletter: 'true',
        obs: '  cliente antigo ',
      }),
    ).toEqual({
      origem: 'Site',
      interesses: ['A', 'B'],
      faturamento: 1500.5,
      nascimento: '1990-02-28',
      newsletter: true,
      obs: 'cliente antigo',
    });
  });

  it('recusa campo desconhecido, opção inválida e data inexistente', () => {
    expect(issuesOf(() => applyCustomFields(defs, { origem: 'TV', nascimento: '2023-02-30', cor: 'azul' })))
      .toEqual(['custom.origem', 'custom.nascimento', 'custom.cor']);
  });

  it('exige obrigatórios considerando o que já existe', () => {
    expect(issuesOf(() => applyCustomFields(defs, { obs: 'x' }))).toEqual(['custom.origem']);
    expect(applyCustomFields(defs, { obs: 'x' }, { origem: 'Site' })).toEqual({ origem: 'Site', obs: 'x' });
  });

  it('null ou vazio remove o valor (e um obrigatório não pode ser removido)', () => {
    expect(applyCustomFields(defs, { obs: '' }, { origem: 'Site', obs: 'antes' })).toEqual({ origem: 'Site' });
    expect(issuesOf(() => applyCustomFields(defs, { origem: null }, { origem: 'Site' }))).toEqual(['custom.origem']);
  });
});

describe('keyFromLabel', () => {
  it.each([
    ['Data de nascimento', 'data_de_nascimento'],
    ['Região / Estado', 'regiao_estado'],
    ['2º contato', 'campo_2_contato'],
    ['!!!', 'campo'],
  ])('%s → %s', (label, key) => {
    expect(keyFromLabel(label)).toBe(key);
  });
});
