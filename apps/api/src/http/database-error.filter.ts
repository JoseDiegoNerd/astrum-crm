import { type ArgumentsHost, Catch, HttpException, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

// Erros do Postgres (RLS, constraints, funções) viram respostas HTTP coerentes.
const PG_TO_HTTP: Record<string, { status: HttpStatus; message?: string }> = {
  '42501': { status: HttpStatus.FORBIDDEN, message: 'Sem permissão para esta operação' },
  P0002: { status: HttpStatus.NOT_FOUND },
  '23505': { status: HttpStatus.CONFLICT, message: 'Registro já existe' },
  '23503': { status: HttpStatus.UNPROCESSABLE_ENTITY, message: 'Referência inválida' },
  '23514': { status: HttpStatus.UNPROCESSABLE_ENTITY },
  '22P02': { status: HttpStatus.BAD_REQUEST, message: 'Valor inválido' },
};

// Mensagens específicas por constraint (nomes vêm das migrations).
const CONSTRAINT_MESSAGES: Record<string, string> = {
  contact_identities_workspace_id_channel_identifier_key:
    'Já existe um contato com este identificador neste workspace',
  contact_identities_one_primary_key: 'O contato já tem uma identidade principal neste canal',
  contact_identities_identifier_format: 'Identificador em formato inválido',
  companies_workspace_document_key: 'Já existe uma empresa com este CNPJ neste workspace',
  contacts_workspace_id_company_id_fkey: 'Empresa não encontrada neste workspace',
  contacts_tenant_id_owner_id_fkey: 'O responsável precisa ser membro da conta',
  companies_tenant_id_owner_id_fkey: 'O responsável precisa ser membro da conta',
  contact_identities_workspace_id_contact_id_fkey: 'Contato não encontrado neste workspace',
  tags_workspace_name_key: 'Já existe uma tag com este nome neste workspace',
  contact_tags_workspace_id_tag_id_fkey: 'Tag não encontrada neste workspace',
  company_tags_workspace_id_tag_id_fkey: 'Tag não encontrada neste workspace',
  custom_field_defs_workspace_id_entity_key_key: 'Já existe um campo com esta chave',
  custom_field_defs_options_check: 'Seleção exige opções; os demais tipos não usam opções',
};

interface PgError {
  code: string;
  message: string;
  constraint_name?: string;
}

export function findPgError(error: unknown): PgError | undefined {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    const candidate = current as Partial<PgError> & { cause?: unknown };
    if (typeof candidate.code === 'string' && candidate.code in PG_TO_HTTP) {
      return candidate as PgError;
    }
    current = candidate.cause;
  }
  return undefined;
}

export function toHttpException(error: unknown): HttpException | undefined {
  const pg = findPgError(error);
  if (!pg) return undefined;
  const mapped = PG_TO_HTTP[pg.code]!;
  const byConstraint = pg.constraint_name ? CONSTRAINT_MESSAGES[pg.constraint_name] : undefined;
  return new HttpException(byConstraint ?? mapped.message ?? pg.message, mapped.status);
}

@Catch()
export class DatabaseErrorFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost) {
    super.catch(toHttpException(exception) ?? exception, host);
  }
}
