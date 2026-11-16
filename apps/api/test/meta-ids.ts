/**
 * IDs da Meta únicos por execução. `channels (type, external_id)` é único no
 * banco inteiro: no Postgres real compartilhado, IDs fixos colidem entre
 * arquivos e entre execuções (no PGlite cada arquivo tem o próprio banco).
 */
export const metaId = () => String(100_000_000_000_000 + Math.floor(Math.random() * 899_999_999_999_999));
