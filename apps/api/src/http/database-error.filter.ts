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

interface PgError {
  code: string;
  message: string;
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
  return new HttpException(mapped.message ?? pg.message, mapped.status);
}

@Catch()
export class DatabaseErrorFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost) {
    super.catch(toHttpException(exception) ?? exception, host);
  }
}
