/**
 * Parser de CSV (RFC 4180) para importação.
 * - Detecta o separador pela linha de cabeçalho: ";" (Excel em português), "," ou tab.
 * - Aceita aspas com "" escapado, quebras de linha dentro de aspas, CRLF e BOM.
 * - Ignora linhas totalmente vazias.
 */
export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^﻿/, '');
  const delimiter = detectDelimiter(text);
  const records: string[][] = [];

  let field = '';
  let record: string[] = [];
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
    } else if (char === delimiter) {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const nonEmpty = records.filter((r) => r.some((value) => value.trim() !== ''));
  const [headers = [], ...rows] = nonEmpty;
  return { headers: headers.map((h) => h.trim()), rows, delimiter };
}

function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const count = (d: string) => firstLine.split(d).length - 1;
  const candidates = [';', ',', '\t'].map((d) => [d, count(d)] as const);
  const [best] = candidates.sort((a, b) => b[1] - a[1]);
  return best && best[1] > 0 ? best[0] : ',';
}
