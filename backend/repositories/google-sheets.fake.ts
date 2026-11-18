import { createHash, randomUUID } from 'node:crypto';
import type { AppsScriptRuntime } from '../apps-script';
import type { GoogleRange, GoogleSheet, GoogleSpreadsheet } from './apps-script-sheet-port';
import type { Cell } from './sheets-finance-repository';

export interface FakeWrite { sheet: string; row: number; column: number; values: Cell[][] }

export class FakeGoogleSheet implements GoogleSheet {
  rows: Cell[][] = [];
  maxRows = 1000;
  maxColumns = 26;
  formats: string[] = [];
  constructor(public name: string, private readonly spreadsheet: FakeGoogleSpreadsheet) {}
  getName(): string { return this.name; }
  setName(name: string): void { this.name = name; }
  getLastRow(): number { this.spreadsheet.record('getLastRow'); return this.rows.length; }
  getLastColumn(): number { this.spreadsheet.record('getLastColumn'); return Math.max(0, ...this.rows.map((row) => row.length)); }
  getMaxRows(): number { this.spreadsheet.record('getMaxRows'); return this.maxRows; }
  getMaxColumns(): number { this.spreadsheet.record('getMaxColumns'); return this.maxColumns; }
  insertRowsAfter(_position: number, count: number): void { this.spreadsheet.record('insertRowsAfter'); this.maxRows += count; }
  insertColumnsAfter(_position: number, count: number): void { this.spreadsheet.record('insertColumnsAfter'); this.maxColumns += count; }
  deleteRows(row: number, count: number): void { this.spreadsheet.record('deleteRows'); this.rows.splice(row - 1, count); this.maxRows -= count; }
  getRange(row: number, column: number, rows: number, columns: number): GoogleRange {
    this.spreadsheet.record('getRange');
    if (![row, column, rows, columns].every((value) => Number.isInteger(value) && value > 0) || row + rows - 1 > this.maxRows || column + columns - 1 > this.maxColumns) throw new Error('Intervalo fora da capacidade física da aba');
    return {
      getValues: () => { this.spreadsheet.record('getValues'); return Array.from({ length: rows }, (_, y) => Array.from({ length: columns }, (_, x) => this.rows[row + y - 1]?.[column + x - 1] ?? '')); },
      setNumberFormat: (format) => { this.spreadsheet.record('setNumberFormat'); this.formats.push(format); },
      setValues: (values) => {
        this.spreadsheet.record('setValues');
        const write: FakeWrite = { sheet: this.name, row, column, values: structuredClone(values) };
        this.spreadsheet.beforeWrite?.(write);
        this.spreadsheet.writes.push(write);
        values.forEach((cells, y) => {
          const index = row + y - 1;
          while (this.rows.length <= index) this.rows.push([]);
          cells.forEach((value, x) => {
            // Simula a entrada literal de setValues: o marcador inicial é interpretado pelo Sheets.
            this.rows[index][column + x - 1] = typeof value === 'string' && value.startsWith("'") ? value.slice(1) : value;
          });
        });
        this.spreadsheet.afterWrite?.(write);
      },
    };
  }
}

export class FakeGoogleSpreadsheet implements GoogleSpreadsheet {
  sheets: FakeGoogleSheet[] = [new FakeGoogleSheet('Página1', this)];
  writes: FakeWrite[] = [];
  beforeWrite?: (write: FakeWrite) => void;
  afterWrite?: (write: FakeWrite) => void;
  calls: Record<string, number> = {};
  record(name: string): void { this.calls[name] = (this.calls[name] ?? 0) + 1; }
  resetCalls(): void { this.calls = {}; }
  getId(): string { return 'spreadsheet-owner-only'; }
  getUrl(): string { return `https://docs.google.com/spreadsheets/d/${this.getId()}/edit`; }
  getSheets(): FakeGoogleSheet[] { return this.sheets; }
  getSheetByName(name: string): FakeGoogleSheet | null { this.record('getSheetByName'); return this.sheets.find((sheet) => sheet.name === name) ?? null; }
  insertSheet(name: string): FakeGoogleSheet { this.record('insertSheet'); const sheet = new FakeGoogleSheet(name, this); this.sheets.push(sheet); return sheet; }
}

export function runtimeFixture() {
  const spreadsheet = new FakeGoogleSpreadsheet();
  const properties = new Map<string, string>();
  let now = new Date('2026-11-17T12:00:00.000Z');
  let locked = false;
  let lockCount = 0;
  let releaseCount = 0;
  let flushCount = 0;
  let created = 0;
  let failFlushAt: number | undefined;
  const runtime: AppsScriptRuntime = {
    SpreadsheetApp: {
      create: () => { created++; return spreadsheet; },
      openById: (id) => { if (id !== spreadsheet.getId()) throw new Error('Planilha desconhecida'); return spreadsheet; },
      flush: () => { if (!locked) throw new Error('Flush fora do lock'); flushCount++; if (failFlushAt === flushCount) throw new Error('Falha simulada no flush'); },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties.get(key) ?? null, setProperty: (key, value) => { properties.set(key, value); } }) },
    LockService: { getScriptLock: () => ({ waitLock: () => { if (locked) throw new Error('Lock já adquirido'); locked = true; lockCount++; }, releaseLock: () => { locked = false; releaseCount++; } }) },
    Utilities: { getUuid: randomUUID, DigestAlgorithm: { SHA_256: 'SHA256' }, Charset: { UTF_8: 'UTF8' }, computeDigest: (_algorithm, input) => [...createHash('sha256').update(input, 'utf8').digest()].map((byte) => byte > 127 ? byte - 256 : byte) },
  };
  spreadsheet.beforeWrite = () => { if (!locked) throw new Error('Gravação fora do lock'); };
  return {
    runtime, spreadsheet, properties, clock: () => new Date(now), setNow: (value: Date) => { now = value; },
    stats: () => ({ locked, lockCount, releaseCount, flushCount, created }), failNextFlush: () => { failFlushAt = flushCount + 1; },
  };
}
