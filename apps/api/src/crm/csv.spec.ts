import { parseCsv } from './csv.js';

describe('parseCsv', () => {
  it('lê CSV com ponto e vírgula (Excel em português), BOM e CRLF', () => {
    const csv = '﻿Nome;Telefone;Empresa\r\nAna Souza;(11) 99999-0000;Padaria Sol\r\nBruno;;\r\n';
    expect(parseCsv(csv)).toEqual({
      delimiter: ';',
      headers: ['Nome', 'Telefone', 'Empresa'],
      rows: [
        ['Ana Souza', '(11) 99999-0000', 'Padaria Sol'],
        ['Bruno', '', ''],
      ],
    });
  });

  it('respeita aspas, aspas escapadas e quebra de linha dentro de campo', () => {
    const csv = 'name,notes\n"Silva, Ana","disse ""oi""\nem duas linhas"\n';
    expect(parseCsv(csv).rows).toEqual([['Silva, Ana', 'disse "oi"\nem duas linhas']]);
  });

  it('detecta tab e ignora linhas vazias', () => {
    const csv = 'nome\temail\n\nAna\tana@x.com\n   \t \nBia\tbia@x.com';
    const parsed = parseCsv(csv);
    expect(parsed.delimiter).toBe('\t');
    expect(parsed.rows).toEqual([
      ['Ana', 'ana@x.com'],
      ['Bia', 'bia@x.com'],
    ]);
  });

  it('arquivo vazio não quebra', () => {
    expect(parseCsv('')).toEqual({ delimiter: ',', headers: [], rows: [] });
  });
});
