import { HttpStatus } from '@nestjs/common';
import { toHttpException } from './database-error.filter.js';

const pg = (code: string, message = 'erro do banco') => Object.assign(new Error(message), { code });

describe('toHttpException', () => {
  it.each([
    ['42501', HttpStatus.FORBIDDEN],
    ['P0002', HttpStatus.NOT_FOUND],
    ['23505', HttpStatus.CONFLICT],
    ['23503', HttpStatus.UNPROCESSABLE_ENTITY],
    ['23514', HttpStatus.UNPROCESSABLE_ENTITY],
    ['22P02', HttpStatus.BAD_REQUEST],
  ])('mapeia código %s para HTTP %i', (code, status) => {
    expect(toHttpException(pg(code))?.getStatus()).toBe(status);
  });

  it('encontra o erro do Postgres dentro do erro do Drizzle', () => {
    const wrapped = Object.assign(new Error('Failed query'), { cause: pg('42501') });
    expect(toHttpException(wrapped)?.getStatus()).toBe(HttpStatus.FORBIDDEN);
  });

  it('repassa a mensagem das regras de negócio do banco', () => {
    const error = pg('23514', 'O tenant precisa de pelo menos um owner ativo');
    expect(toHttpException(error)?.message).toBe('O tenant precisa de pelo menos um owner ativo');
  });

  it('usa a mensagem da constraint quando conhecida', () => {
    const error = Object.assign(pg('23505'), {
      constraint_name: 'contact_identities_workspace_id_channel_identifier_key',
    });
    const http = toHttpException(error);
    expect(http?.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(http?.message).toBe('Já existe um contato com este identificador neste workspace');
  });

  it('ignora erros que não são do banco', () => {
    expect(toHttpException(new Error('boom'))).toBeUndefined();
  });
});
