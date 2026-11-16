import { type ArgumentsHost, Catch, HttpException, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

// Erros do Postgres (RLS, constraints, funções) viram respostas HTTP coerentes.
const PG_TO_HTTP: Record<string, { status: HttpStatus; message?: string }> = {
  '42501': { status: HttpStatus.FORBIDDEN, message: 'Sem permissão para esta operação' },
  P0002: { status: HttpStatus.NOT_FOUND },
  '23505': { status: HttpStatus.CONFLICT, message: 'Registro já existe' },
  '23503': { status: HttpStatus.UNPROCESSABLE_ENTITY, message: 'Referência inválida' },
  // on delete restrict: ainda há registros dependentes
  '23001': { status: HttpStatus.CONFLICT, message: 'Há registros que dependem deste' },
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
  deal_tags_workspace_id_tag_id_fkey: 'Tag não encontrada neste workspace',
  pipelines_one_default_key: 'Já existe um pipeline padrão neste workspace',
  deals_pipeline_id_stage_id_fkey: 'A etapa não pertence ao pipeline do negócio, ou ainda tem negócios',
  deals_workspace_id_pipeline_id_fkey: 'Pipeline não encontrado, ou ainda tem negócios',
  deals_workspace_id_contact_id_fkey: 'Contato não encontrado neste workspace',
  deals_workspace_id_company_id_fkey: 'Empresa não encontrada neste workspace',
  deals_tenant_id_owner_id_fkey: 'O responsável precisa ser membro da conta',
  tasks_tenant_id_assignee_id_fkey: 'O responsável precisa ser membro da conta',
  tasks_workspace_id_contact_id_fkey: 'Contato não encontrado neste workspace',
  tasks_workspace_id_deal_id_fkey: 'Negócio não encontrado neste workspace',
  tasks_workspace_id_company_id_fkey: 'Empresa não encontrada neste workspace',
  notes_workspace_id_contact_id_fkey: 'Contato não encontrado neste workspace',
  notes_workspace_id_deal_id_fkey: 'Negócio não encontrado neste workspace',
  notes_workspace_id_company_id_fkey: 'Empresa não encontrada neste workspace',
  notes_subject_check: 'Informe o contato, negócio ou empresa da nota',
  channels_type_external_id_key: 'Este número já está conectado ao Astrum (neste ou em outro workspace)',
  conversations_one_active_key: 'Já existe uma conversa ativa com este contato neste canal',
  // mesmas constraints, mas no caminho do delete bloqueado (código 23001)
  '23001:deals_pipeline_id_stage_id_fkey': 'Esta etapa ainda tem negócios; mova-os antes de excluir',
  '23001:conversations_workspace_id_channel_id_fkey': 'Este canal tem conversas: desative-o em vez de excluir',
  '23001:deals_workspace_id_pipeline_id_fkey': 'Este pipeline ainda tem negócios; mova-os antes de excluir',
};

interface PgError {
  code: string;
  message: string;
  /** postgres.js (produção) */
  constraint_name?: string;
  /** PGlite (testes) */
  constraint?: string;
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
  const found = findPgError(error);
  if (!found) return undefined;
  // FK "on delete restrict": o Postgres real devolve 23503 ("update or delete on
  // table … violates foreign key"), o PGlite devolve 23001. É exclusão bloqueada
  // por dependentes (409), não referência inválida num insert (422).
  const pg =
    found.code === '23503' && /^update or delete on table/i.test(found.message) ? { ...found, code: '23001' } : found;
  const mapped = PG_TO_HTTP[pg.code]!;
  // 42501 vindo das nossas regras (triggers) traz mensagem em português; a da RLS
  // ("new row violates…" / "permission denied…") é técnica e vira a genérica
  if (pg.code === '42501' && !/row-level security|permission denied/i.test(pg.message)) {
    return new HttpException(pg.message, mapped.status);
  }
  const constraint = pg.constraint_name ?? pg.constraint;
  const byConstraint = constraint
    ? (CONSTRAINT_MESSAGES[`${pg.code}:${constraint}`] ?? CONSTRAINT_MESSAGES[constraint])
    : undefined;
  return new HttpException(byConstraint ?? mapped.message ?? pg.message, mapped.status);
}

@Catch()
export class DatabaseErrorFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost) {
    super.catch(toHttpException(exception) ?? exception, host);
  }
}
