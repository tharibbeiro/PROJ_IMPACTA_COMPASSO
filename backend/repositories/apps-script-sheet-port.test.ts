import { describe, expect, it } from 'vitest';
import { AppsScriptSheetPort, literalCell } from './apps-script-sheet-port';
import { FakeGoogleSpreadsheet } from './google-sheets.fake';

describe('adaptação literal de células Google Sheets', () => {
  it('escapa fórmulas e apóstrofos preservando texto original e datas civis', () => {
    const spreadsheet = new FakeGoogleSpreadsheet();
    const port = new AppsScriptSheetPort(spreadsheet);
    port.ensureSheet('Teste', ['texto', 'data', 'centavos', 'marcado']);
    const values = ['=SUM(A1:A2)', '+COMANDO', '-texto', '@nome', "'apóstrofo", ' \t=SUM(A1)', '2026-11-17'];
    for (const value of values) port.append('Teste', [[value, '2026-11-17', 12345, true]]);
    const read = port.read('Teste');
    expect(read.slice(1).map((row) => row[0])).toEqual(values);
    expect(read[1]).toEqual(['=SUM(A1:A2)', '2026-11-17', 12345, true]);
    expect(spreadsheet.writes[1].values[0][0]).toBe("'=SUM(A1:A2)");
    expect(spreadsheet.getSheetByName('Teste')!.formats.every((format) => format === '@')).toBe(true);
  });

  it('não interpreta números como fórmulas e rejeita datas coercidas manualmente', () => {
    expect(literalCell(-123)).toBe(-123);
    const spreadsheet = new FakeGoogleSpreadsheet();
    const port = new AppsScriptSheetPort(spreadsheet);
    port.ensureSheet('Teste', ['data']);
    spreadsheet.getSheetByName('Teste')!.rows.push([new Date() as unknown as string]);
    expect(() => port.read('Teste')).toThrow('texto');
  });

  it('detecta cabeçalhos alterados e não remove a linha de cabeçalho na limpeza', () => {
    const spreadsheet = new FakeGoogleSpreadsheet();
    const port = new AppsScriptSheetPort(spreadsheet);
    port.ensureSheet('Teste', ['id']);
    expect(() => port.ensureSheet('Teste', ['outro'])).toThrow('cabeçalhos');
    expect(() => port.deleteRows('Teste', 1, 1)).toThrow('inválidas');
  });
});
