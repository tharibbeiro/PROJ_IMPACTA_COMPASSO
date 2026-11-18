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

interface CachedSheet {
  sheet: GoogleSheet;
  values?: Cell[][];
  lastRow?: number;
  lastColumn?: number;
  maxRows?: number;
  maxColumns?: number;
}

/** Cache exclusivo da requisição; o controlador cria uma porta nova a cada RPC. */
export class AppsScriptSheetPort implements SheetsPort {
  private readonly cache = new Map<string, CachedSheet>();

  constructor(private readonly spreadsheet: GoogleSpreadsheet, private readonly flushWrites: () => void = () => {}) {}

  flush(): void {
    try { this.flushWrites(); }
    catch (error) { this.cache.clear(); throw error; }
  }

  read(name: string, options: { fresh?: boolean } = {}): Cell[][] {
    if (options.fresh) this.cache.delete(name);
    const state = this.sheet(name);
    if (!state.values) {
      const rows = state.lastRow ?? (state.lastRow = state.sheet.getLastRow());
      const columns = state.lastColumn ?? (state.lastColumn = state.sheet.getLastColumn());
      state.values = !rows || !columns ? [] : state.sheet.getRange(1, 1, rows, columns).getValues().map((row) => row.map((value) => {
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new AppError('A planilha contém um valor incompatível. Preserve as datas e os identificadores como texto.', 503);
        return value;
      }));
    }
    // Chamadores não podem alterar a cópia confirmada pela porta.
    return state.values.map((row) => [...row]);
  }

  append(name: string, rows: Cell[][]): void {
    if (!rows.length) return;
    const columns = rows[0].length;
    if (!columns || rows.some((row) => row.length !== columns)) throw new AppError('As linhas da planilha possuem formatos incompatíveis.', 500);
    this.mutate(name, (state) => {
      const start = (state.lastRow ?? (state.lastRow = state.sheet.getLastRow())) + 1;
      this.capacity(state, start + rows.length - 1, columns);
      const range = state.sheet.getRange(start, 1, rows.length, columns);
      range.setNumberFormat('@');
      range.setValues(rows.map((row) => row.map(literalCell)));
      if (state.values) {
        state.values.push(...rows.map((row) => [...row]));
        this.normalize(state);
      } else {
        // Sem uma leitura prévia, não presumimos o tamanho dos dados existentes.
        state.lastRow = undefined; state.lastColumn = undefined;
      }
    });
  }

  replaceCell(name: string, row: number, column: number, value: Cell): void {
    this.mutate(name, (state) => {
      this.capacity(state, row, column);
      const range = state.sheet.getRange(row, column, 1, 1);
      range.setNumberFormat('@');
      range.setValues([[literalCell(value)]]);
      if (state.values) {
        while (state.values.length < row) state.values.push([]);
        state.values[row - 1][column - 1] = value;
        this.normalize(state);
      } else { state.lastRow = undefined; state.lastColumn = undefined; }
    });
  }

  ensureSheet(name: string, headers: readonly string[]): void {
    if (!this.cache.has(name)) {
      const sheet = this.spreadsheet.getSheetByName(name) ?? this.spreadsheet.insertSheet(name);
      this.cache.set(name, { sheet });
    }
    const values = this.read(name);
    if (!values.length) {
      this.append(name, [[...headers]]);
      return;
    }
    const actual = values[0];
    if (headers.some((header, index) => actual[index] !== header)) throw new AppError(`Os cabeçalhos da aba ${name} foram alterados. Restaure a estrutura configurada antes de continuar.`, 503);
  }

  deleteRows(name: string, row: number, count: number): void {
    if (row < 2 || !Number.isInteger(row) || !Number.isInteger(count) || count < 1) throw new AppError('A limpeza da planilha recebeu linhas inválidas.', 500);
    this.mutate(name, (state) => {
      state.sheet.deleteRows(row, count);
      // Excluir linhas também reduz a capacidade física da aba.
      if (state.maxRows !== undefined) state.maxRows -= count;
      if (state.values) { state.values.splice(row - 1, count); this.normalize(state); }
      else { state.lastRow = undefined; state.lastColumn = undefined; }
    });
  }

  private sheet(name: string): CachedSheet {
    const cached = this.cache.get(name);
    if (cached) return cached;
    const sheet = this.spreadsheet.getSheetByName(name);
    if (!sheet) throw new AppError('A planilha ainda não está configurada. Execute configurarCompasso_ no editor do Apps Script.', 503);
    const state = { sheet };
    this.cache.set(name, state);
    return state;
  }

  private mutate(name: string, operation: (state: CachedSheet) => void): void {
    try { operation(this.sheet(name)); }
    catch (error) {
      // A API pode ter aplicado parte da escrita antes de informar uma falha.
      this.cache.delete(name);
      throw error;
    }
  }

  private capacity(state: CachedSheet, rows: number, columns: number): void {
    const maxRows = state.maxRows ?? (state.maxRows = state.sheet.getMaxRows());
    const maxColumns = state.maxColumns ?? (state.maxColumns = state.sheet.getMaxColumns());
    if (rows > maxRows) { state.sheet.insertRowsAfter(maxRows, rows - maxRows); state.maxRows = rows; }
    if (columns > maxColumns) { state.sheet.insertColumnsAfter(maxColumns, columns - maxColumns); state.maxColumns = columns; }
  }

  private normalize(state: CachedSheet): void {
    const values = state.values!;
    while (values.length && values[values.length - 1].every((cell) => cell === '' || cell === undefined)) values.pop();
    let columns = 0;
    for (const row of values) {
      let last = row.length;
      while (last && (row[last - 1] === '' || row[last - 1] === undefined)) last--;
      columns = Math.max(columns, last);
    }
    state.values = values.map((row) => Array.from({ length: columns }, (_, index) => row[index] ?? ''));
    state.lastRow = values.length; state.lastColumn = columns;
  }
}
