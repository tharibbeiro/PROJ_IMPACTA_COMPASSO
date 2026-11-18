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
    expect(() => new AppsScriptSheetPort(spreadsheet).read('Teste')).toThrow('texto');
  });

  it('detecta cabeçalhos alterados e não remove a linha de cabeçalho na limpeza', () => {
    const spreadsheet = new FakeGoogleSpreadsheet();
    const port = new AppsScriptSheetPort(spreadsheet);
    port.ensureSheet('Teste', ['id']);
    expect(() => port.ensureSheet('Teste', ['outro'])).toThrow('cabeçalhos');
    expect(() => port.deleteRows('Teste', 1, 1)).toThrow('inválidas');
  });
});


describe('cache de planilha limitado à requisição', () => {
  function existing() {
    const spreadsheet = new FakeGoogleSpreadsheet();
    const setup = new AppsScriptSheetPort(spreadsheet);
    setup.ensureSheet('Teste', ['id', 'data', 'centavos']);
    setup.append('Teste', [['original', '2026-11-18', 100]]);
    spreadsheet.resetCalls();
    return { spreadsheet, port: new AppsScriptSheetPort(spreadsheet) };
  }

  it('reaproveita a leitura de cabeçalho e dados e retorna cópias defensivas', () => {
    const { spreadsheet, port } = existing();
    port.ensureSheet('Teste', ['id', 'data', 'centavos']);
    const first = port.read('Teste');
    first[1][0] = 'Objeto externo';
    expect(port.read('Teste')[1][0]).toBe('original');
    expect(spreadsheet.calls.getValues).toBe(1);
    expect(spreadsheet.calls.getSheetByName).toBe(1);
  });

  it('atualiza o cache depois de inserir, substituir e remover linhas sem escapar o valor lógico', () => {
    const { spreadsheet, port } = existing();
    port.read('Teste');
    port.append('Teste', [['=texto literal', '2026-12-01', 250]]);
    port.replaceCell('Teste', 3, 1, "'texto original");
    port.deleteRows('Teste', 2, 1);
    expect(port.read('Teste')).toEqual([['id', 'data', 'centavos'], ["'texto original", '2026-12-01', 250]]);
    expect(spreadsheet.calls.getValues).toBe(1);
  });

  it('preserva uma matriz retangular ao aumentar o número de colunas', () => {
    const { port } = existing();
    port.read('Teste');
    port.replaceCell('Teste', 2, 5, 'Coluna adicional');
    expect(port.read('Teste')).toEqual([
      ['id', 'data', 'centavos', '', ''],
      ['original', '2026-11-18', 100, '', 'Coluna adicional'],
    ]);
  });

  it('considera a capacidade física reduzida pela exclusão antes de acrescentar novas linhas', () => {
    const { spreadsheet, port } = existing();
    const sheet = spreadsheet.getSheetByName('Teste')!;
    sheet.maxRows = 3;
    port.read('Teste');
    port.replaceCell('Teste', 2, 1, 'original');
    port.deleteRows('Teste', 2, 1);
    expect(sheet.maxRows).toBe(2);
    port.append('Teste', [['nova', '2026-12-01', 200], ['outra', '2026-12-02', 300]]);
    expect(sheet.maxRows).toBe(3);
    expect(port.read('Teste').slice(1).map((row) => row[0])).toEqual(['nova', 'outra']);
  });

  it('relê a planilha após uma escrita aplicada que informa falha', () => {
    const { spreadsheet, port } = existing();
    port.read('Teste');
    spreadsheet.afterWrite = () => { throw new Error('Resposta perdida após aplicação'); };
    expect(() => port.replaceCell('Teste', 2, 1, 'já aplicado')).toThrow('Resposta perdida');
    spreadsheet.afterWrite = undefined;
    expect(port.read('Teste')[1][0]).toBe('já aplicado');
    expect(spreadsheet.calls.getValues).toBe(2);
  });

  it('invalida leituras após falha no flush e permite confirmação pelo estado físico', () => {
    const { spreadsheet } = existing();
    const port = new AppsScriptSheetPort(spreadsheet, () => {
      spreadsheet.sheets.find((sheet) => sheet.name === 'Teste')!.rows[1][0] = 'Confirmado no serviço';
      throw new Error('Falha no flush');
    });
    port.read('Teste');
    expect(() => port.flush()).toThrow('Falha no flush');
    expect(port.read('Teste')[1][0]).toBe('Confirmado no serviço');
  });

  it('uma nova requisição e uma leitura de confirmação enxergam alterações externas', () => {
    const { spreadsheet, port } = existing();
    port.read('Teste');
    spreadsheet.sheets.find((sheet) => sheet.name === 'Teste')!.rows[1][0] = 'Alteração posterior';
    expect(port.read('Teste')[1][0]).toBe('original');
    expect(new AppsScriptSheetPort(spreadsheet).read('Teste')[1][0]).toBe('Alteração posterior');
    expect(port.read('Teste', { fresh: true })[1][0]).toBe('Alteração posterior');
    spreadsheet.sheets.find((sheet) => sheet.name === 'Teste')!.rows[0][0] = 'Cabeçalho alterado';
    expect(() => new AppsScriptSheetPort(spreadsheet).ensureSheet('Teste', ['id', 'data', 'centavos'])).toThrow('cabeçalhos');
  });
});
