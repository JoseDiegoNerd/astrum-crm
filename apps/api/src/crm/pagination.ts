import { BadRequestException } from '@nestjs/common';
import { sql, type AnyPgColumn, type SQL } from '@astrum/db';

/** Cursor opaco para listas ordenadas por (created_at desc, id desc). */
export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
}

export function decodeCursor(cursor: string): Cursor {
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const date = new Date(createdAt ?? '');
  if (!id || Number.isNaN(date.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw new BadRequestException('Cursor inválido');
  }
  return { createdAt: date, id };
}

/** Condição "depois do cursor" para ordenação descendente. */
export function afterCursor(createdAt: AnyPgColumn, id: AnyPgColumn, cursor: Cursor): SQL {
  return sql`(${createdAt}, ${id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`;
}

/** Busca limit+1 linhas para saber se há próxima página. */
export function page<T extends { createdAt: Date; id: string }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
}

/** Escapa % e _ para uso em ILIKE. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, '\\$&')}%`;
}
