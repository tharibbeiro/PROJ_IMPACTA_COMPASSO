import { AppError } from '../contracts';
import type { Cell, SheetsPort } from './sheets-finance-repository';

export interface GoogleRange {
  getValues(): unknown[][];
  setValues(values: Cell[][]): unknown;
  setNumberFormat(format: string): unknown;
}

export interface GoogleSheet {
  getName(): string;
  setName(name: string): unknown;
  getLastRow(): number;
  getLastColumn(): number;
  getMaxRows(): number;
  getMaxColumns(): number;
  insertRowsAfter(position: number, count: number): unknown;
  insertColumnsAfter(position: number, count: number): unknown;
  getRange(row: number, column: number, rows: number, columns: number): GoogleRange;
  deleteRows(row: number, count: number): unknown;
}

export interface GoogleSpreadsheet {
  getId(): string;
  getUrl(): string;
  getSheets(): GoogleSheet[];
  getSheetByName(name: string): GoogleSheet | null;
  insertSheet(name: string): GoogleSheet;
}

/** Valor literal enviado ao Sheets: o apóstrofo de escape não faz parte de getValues(). */
export function literalCell(value: Cell): Cell {
  return typeof value === 'string' && /^[\s\ufeff]*[=+\-@']/.test(value) ? `'${value}` : value;
}

export class AppsScriptSheetPort implements SheetsPort {
  constructor(private readonly spreadsheet: GoogleSpreadsheet, private readonly flushWrites: () => void = () => {}) {}

  flush(): void { this.flushWrites(); }

  read(name: string): Cell[][] {
    const sheet = this.sheet(name);
    const rows = sheet.getLastRow();
    const columns = sheet.getLastColumn();
    if (!rows || !columns) return [];
    return sheet.getRange(1, 1, rows, columns).getValues().map((row) => row.map((value) => {
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new AppError('A planilha contém um valor incompatível. Preserve as datas e os identificadores como texto.', 503);
      return value;
    }));
  }

  append(name: string, rows: Cell[][]): void {
    if (!rows.length) return;
    const columns = rows[0].length;
    if (!columns || rows.some((row) => row.length !== columns)) throw new AppError('As linhas da planilha possuem formatos incompatíveis.', 500);
    const sheet = this.sheet(name);
    const start = sheet.getLastRow() + 1;
    this.capacity(sheet, start + rows.length - 1, columns);
    const range = sheet.getRange(start, 1, rows.length, columns);
    range.setNumberFormat('@');
    range.setValues(rows.map((row) => row.map(literalCell)));
  }

  replaceCell(name: string, row: number, column: number, value: Cell): void {
    const sheet = this.sheet(name);
    this.capacity(sheet, row, column);
    const range = sheet.getRange(row, column, 1, 1);
    range.setNumberFormat('@');
    range.setValues([[literalCell(value)]]);
  }

  ensureSheet(name: string, headers: readonly string[]): void {
    let sheet = this.spreadsheet.getSheetByName(name);
    if (!sheet) sheet = this.spreadsheet.insertSheet(name);
    if (!sheet.getLastRow()) {
      this.append(name, [[...headers]]);
      return;
    }
    this.capacity(sheet, 1, headers.length);
    const actual = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    if (headers.some((header, index) => actual[index] !== header)) throw new AppError(`Os cabeçalhos da aba ${name} foram alterados. Restaure a estrutura configurada antes de continuar.`, 503);
  }

  deleteRows(name: string, row: number, count: number): void {
    if (row < 2 || !Number.isInteger(row) || !Number.isInteger(count) || count < 1) throw new AppError('A limpeza da planilha recebeu linhas inválidas.', 500);
    this.sheet(name).deleteRows(row, count);
  }

  private sheet(name: string): GoogleSheet {
    const sheet = this.spreadsheet.getSheetByName(name);
    if (!sheet) throw new AppError('A planilha ainda não está configurada. Execute configurarCompasso_ no editor do Apps Script.', 503);
    return sheet;
  }

  private capacity(sheet: GoogleSheet, rows: number, columns: number): void {
    const maxRows = sheet.getMaxRows();
    const maxColumns = sheet.getMaxColumns();
    if (rows > maxRows) sheet.insertRowsAfter(maxRows, rows - maxRows);
    if (columns > maxColumns) sheet.insertColumnsAfter(maxColumns, columns - maxColumns);
  }
}
