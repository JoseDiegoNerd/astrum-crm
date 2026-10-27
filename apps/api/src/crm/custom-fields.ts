import { BadRequestException } from '@nestjs/common';
import type { CustomFieldDef } from '@astrum/db';

type Def = Pick<CustomFieldDef, 'key' | 'label' | 'type' | 'options' | 'required'>;
type Values = Record<string, unknown>;

/**
 * Valida e mescla valores de campos customizados (coluna `custom` jsonb).
 *
 * - `patch` traz só os campos alterados; `null` ou vazio remove o valor.
 * - Chaves sem definição no workspace são recusadas.
 * - Valores são normalizados (número de string, data YYYY-MM-DD, multiseleção sem repetição).
 * - Obrigatórios são conferidos no resultado final (`existing` + `patch`).
 */
export function applyCustomFields(defs: Def[], patch: Values, existing: Values = {}): Values {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const result: Values = { ...existing };
  const issues: { path: string; message: string }[] = [];

  for (const [key, raw] of Object.entries(patch)) {
    const def = byKey.get(key);
    if (!def) {
      issues.push({ path: `custom.${key}`, message: 'Campo não existe neste workspace' });
      continue;
    }
    if (isEmpty(raw)) {
      delete result[key];
      continue;
    }
    const parsed = parseValue(def, raw);
    if (parsed.ok) result[key] = parsed.value;
    else issues.push({ path: `custom.${key}`, message: `${def.label}: ${parsed.message}` });
  }

  const invalid = new Set(issues.map((i) => i.path));
  for (const def of defs) {
    if (def.required && isEmpty(result[def.key]) && !invalid.has(`custom.${def.key}`)) {
      issues.push({ path: `custom.${def.key}`, message: `${def.label} é obrigatório` });
    }
  }

  if (issues.length > 0) throw new BadRequestException({ message: issues[0]!.message, issues });
  return result;
}

function isEmpty(value: unknown) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}

type Parsed = { ok: true; value: unknown } | { ok: false; message: string };

function parseValue(def: Def, raw: unknown): Parsed {
  switch (def.type) {
    case 'text': {
      if (typeof raw !== 'string') return { ok: false, message: 'deve ser texto' };
      const value = raw.trim();
      return value.length > 1000 ? { ok: false, message: 'máximo de 1000 caracteres' } : { ok: true, value };
    }
    case 'number': {
      const value = typeof raw === 'string' ? Number(raw.replace(',', '.')) : raw;
      return typeof value === 'number' && Number.isFinite(value)
        ? { ok: true, value }
        : { ok: false, message: 'deve ser um número' };
    }
    case 'date': {
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return { ok: false, message: 'use o formato AAAA-MM-DD' };
      }
      const date = new Date(`${raw}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(raw)
        ? { ok: true, value: raw }
        : { ok: false, message: 'data inválida' };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      if (raw === 'true' || raw === 'false') return { ok: true, value: raw === 'true' };
      return { ok: false, message: 'deve ser sim ou não' };
    }
    case 'select':
      return typeof raw === 'string' && def.options.includes(raw)
        ? { ok: true, value: raw }
        : { ok: false, message: 'opção inválida' };
    case 'multiselect': {
      const list = Array.isArray(raw) ? raw : [raw];
      if (!list.every((v) => typeof v === 'string' && def.options.includes(v))) {
        return { ok: false, message: 'opção inválida' };
      }
      return { ok: true, value: [...new Set(list as string[])] };
    }
  }
}

/** "Data de nascimento" → "data_de_nascimento" (chave padrão de um campo novo). */
export function keyFromLabel(label: string): string {
  const key = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'campo_$1')
    .slice(0, 40);
  return key || 'campo';
}
