export * from './schema.js';
export * from './client.js';
export * from './insert.js';
// Reexportados para que os apps usem a mesma instância do drizzle-orm
export { and, asc, count, desc, eq, exists, gt, ilike, inArray, isNotNull, isNull, lt, max, min, ne, or, sql, sum } from 'drizzle-orm';
export type { SQL } from 'drizzle-orm';
export type { AnyPgColumn } from 'drizzle-orm/pg-core';
