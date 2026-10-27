import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeWorkspaceTable } from './workspace-table-suite.js';

// Garante que o template de tabela de workspace continua seguro: aplica-o numa
// tabela descartável e roda a suíte de isolamento completa contra ela.
const here = dirname(fileURLToPath(import.meta.url));
const table = `template_probe_${crypto.randomUUID().slice(0, 8)}`;

describeWorkspaceTable({
  table,
  values: { name: 'Exemplo' },
  update: { name: 'Exemplo editado' },
  setup: async (db) => {
    const template = await readFile(join(here, '../templates/workspace-table.sql'), 'utf8');
    await db.exec(template.replaceAll('__table__', table));
  },
  // no Postgres real os dados persistem; a tabela de prova não deve ficar
  teardown: async (db) => {
    await db.exec(`drop table if exists public.${table}`);
  },
});
