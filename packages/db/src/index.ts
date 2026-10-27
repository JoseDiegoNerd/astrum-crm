export * from './schema.js';
export * from './client.js';
// Reexportados para que os apps usem a mesma instância do drizzle-orm
export { and, asc, eq, sql } from 'drizzle-orm';
