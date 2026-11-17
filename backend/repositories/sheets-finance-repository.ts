import { AppError, type AcademicState, type CommitResult, type DemoSession, type FinanceRepository, type LoadedFinanceState } from '../contracts';
import type { Account, Category, Entry, Preferences } from '../../shared/domain/types';
import type { PlanItem, PlanOccurrence, PlanningOccurrenceSnapshot } from '../../shared/domain/planning-types';

/** A porta entrega valores lógicos; a adaptação Google protege strings contra fórmulas. */
export type Cell = string | number | boolean;

export interface SheetsPort {
  /** Inclui o cabeçalho na linha 1. */
  read(sheetName: string): Cell[][];
  append(sheetName: string, rows: Cell[][]): void;
  replaceCell(sheetName: string, row1Based: number, col1Based: number, value: Cell): void;
  ensureSheet(sheetName: string, headers: readonly string[]): void;
  deleteRows(sheetName: string, row1Based: number, count: number): void;
  /** Conclui as escritas pendentes antes de publicar um ponteiro de commit. */
  flush(): void;
}

const prefix = ['sessionId', 'snapshotId', 'revision'] as const;

export const SHEET_HEADERS = {
  Contas: [...prefix, 'id', 'name', 'type', 'openingBalanceCents', 'createdAt'],
  Categorias: [...prefix, 'id', 'name', 'kind', 'color'],
  Lancamentos: [...prefix, 'id', 'description', 'kind', 'amountCents', 'categoryId', 'accountId', 'occurredOn', 'dueOn', 'status', 'paidOn', 'version', 'createdAt', 'updatedAt', 'isExample', 'planId', 'planMonth', 'isCardPayment'],
  Planejamentos: [...prefix, 'id', 'type', 'description', 'amountCents', 'startMonth', 'dueDay', 'categoryId', 'accountId', 'cardName', 'installmentNumber', 'totalInstallments', 'endMonth', 'createdAt', 'updatedAt', 'version', 'archived', 'archivedFromMonth'],
  RegistrosMensais: [...prefix, 'id', 'planId', 'month', 'status', 'linkedEntryId', 'updatedAt', 'snapshotType', 'snapshotDescription', 'snapshotAmountCents', 'snapshotDueOn', 'snapshotCardName', 'snapshotInstallmentNumber', 'snapshotTotalInstallments', 'snapshotRemainingAfterThisMonth', 'snapshotFutureBalanceCents', 'snapshotLastDueOn'],
  Preferencias: [...prefix, 'id', 'displayName', 'exampleMode'],
  Sessoes: ['id', 'tokenHash', 'ponteiroCommit', 'createdAt', 'expiresAt', 'status'],
  Comandos: ['sessionId', 'snapshotId', 'revision', 'parentSnapshotId', 'commandId', 'resultJson', 'createdAt', 'fingerprint'],
} as const;

export type FinanceSheetName = keyof typeof SHEET_HEADERS;
export const SHEETS_MAX_DATA_ROWS = 50_000;
export const SHEETS_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface Pointer { revision: number; snapshotId: string }
interface SessionRecord extends DemoSession { row: number; tokenHash: string; pointer: Pointer; status: string }
interface StoredCommand { snapshotId: string; revision: number; parentSnapshotId: string; commandId: string; resultJson: string; fingerprint?: string }
interface Row { row: number; cells: Cell[] }

function storageError(): AppError {
  return new AppError('Os dados da planilha estão inconsistentes. Verifique os cabeçalhos e os registros da demonstração.', 500);
}

function string(value: Cell | undefined, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value)) throw storageError();
  return value;
}

function number(value: Cell | undefined): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed)) throw storageError();
  return parsed;
}

function boolean(value: Cell | undefined): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'TRUE') return true;
  if (value === 'false' || value === 'FALSE') return false;
  throw storageError();
}

function optionalString(value: Cell | undefined): string | undefined {
  return value === '' || value === undefined ? undefined : string(value);
}

function optionalNumber(value: Cell | undefined): number | undefined {
  return value === '' || value === undefined ? undefined : number(value);
}

function optionalBoolean(value: Cell | undefined): boolean | undefined {
  return value === '' || value === undefined ? undefined : boolean(value);
}

function optionalField<T>(name: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [name]: value };
}

function pointer(raw: Cell | undefined): Pointer {
  let parsed: unknown;
  try { parsed = JSON.parse(string(raw)); } catch { throw storageError(); }
  if (!parsed || typeof parsed !== 'object') throw storageError();
  const result = parsed as Partial<Pointer>;
  if (!Number.isSafeInteger(result.revision) || result.revision! < 0 || typeof result.snapshotId !== 'string' || !result.snapshotId) throw storageError();
  return { revision: result.revision!, snapshotId: result.snapshotId };
}

function assertUnique(items: Array<{ id: string }>): void {
  if (new Set(items.map((item) => item.id)).size !== items.length) throw storageError();
}

function decodeAccount(cells: Cell[]): Account {
  return { id: string(cells[3]), name: string(cells[4]), type: string(cells[5]) as Account['type'], openingBalanceCents: number(cells[6]), createdAt: string(cells[7]) };
}

function decodeCategory(cells: Cell[]): Category {
  return { id: string(cells[3]), name: string(cells[4]), kind: string(cells[5]) as Category['kind'], color: string(cells[6]) };
}

function decodeEntry(cells: Cell[]): Entry {
  return {
    id: string(cells[3]), description: string(cells[4]), kind: string(cells[5]) as Entry['kind'], amountCents: number(cells[6]),
    categoryId: string(cells[7]), accountId: string(cells[8]), occurredOn: string(cells[9]), dueOn: string(cells[10]),
    status: string(cells[11]) as Entry['status'], version: number(cells[13]), createdAt: string(cells[14]), updatedAt: string(cells[15]),
    ...optionalField('paidOn', optionalString(cells[12])), ...optionalField('isExample', optionalBoolean(cells[16])),
    ...optionalField('planId', optionalString(cells[17])), ...optionalField('planMonth', optionalString(cells[18])),
    ...optionalField('isCardPayment', optionalBoolean(cells[19])),
  };
}

function decodePlan(cells: Cell[]): PlanItem {
  return {
    id: string(cells[3]), type: string(cells[4]) as PlanItem['type'], description: string(cells[5]), amountCents: number(cells[6]),
    startMonth: string(cells[7]), dueDay: number(cells[8]), createdAt: string(cells[15]), updatedAt: string(cells[16]), version: number(cells[17]),
    ...optionalField('categoryId', optionalString(cells[9])), ...optionalField('accountId', optionalString(cells[10])),
    ...optionalField('cardName', optionalString(cells[11])), ...optionalField('installmentNumber', optionalNumber(cells[12])),
    ...optionalField('totalInstallments', optionalNumber(cells[13])), ...optionalField('endMonth', optionalString(cells[14])),
    ...optionalField('archived', optionalBoolean(cells[18])), ...optionalField('archivedFromMonth', optionalString(cells[19])),
  };
}

function decodeOccurrence(cells: Cell[]): PlanOccurrence {
  let snapshot: PlanningOccurrenceSnapshot | undefined;
  if (optionalString(cells[9])) {
    snapshot = {
      type: string(cells[9]) as PlanningOccurrenceSnapshot['type'], description: string(cells[10]), amountCents: number(cells[11]), dueOn: string(cells[12]),
      ...optionalField('cardName', optionalString(cells[13])), ...optionalField('installmentNumber', optionalNumber(cells[14])),
      ...optionalField('totalInstallments', optionalNumber(cells[15])), ...optionalField('remainingAfterThisMonth', optionalNumber(cells[16])),
      ...optionalField('futureBalanceCents', optionalNumber(cells[17])), ...optionalField('lastDueOn', optionalString(cells[18])),
    };
  }
  return {
    id: string(cells[3]), planId: string(cells[4]), month: string(cells[5]), status: string(cells[6]) as PlanOccurrence['status'], updatedAt: string(cells[8]),
    ...optionalField('linkedEntryId', optionalString(cells[7])), ...(snapshot ? { snapshot } : {}),
  };
}

/**
 * Cada escrita publica um snapshot completo pela última célula de Sessoes.
 * O controlador deve manter ScriptLock durante create/commit/cleanup para
 * serializar a comparação da revisão e a troca desse ponteiro.
 */
export class SheetsFinanceRepository implements FinanceRepository {
  constructor(
    private readonly port: SheetsPort,
    private readonly clock: () => Date = () => new Date(),
    private readonly uuid: () => string = () => crypto.randomUUID(),
  ) {
    for (const [name, headers] of Object.entries(SHEET_HEADERS)) this.port.ensureSheet(name, headers);
  }

  private rows(name: FinanceSheetName): Row[] {
    const values = this.port.read(name);
    const headers = SHEET_HEADERS[name];
    if (!values.length || headers.some((header, index) => values[0][index] !== header)) throw storageError();
    return values.slice(1).map((cells, index) => ({ cells, row: index + 2 })).filter(({ cells }) => cells.some((cell) => cell !== ''));
  }

  private now(): Date {
    const now = this.clock();
    if (!Number.isFinite(now.getTime())) throw new AppError('O relógio da demonstração está indisponível.', 500);
    return now;
  }

  private sessionRecords(): SessionRecord[] {
    return this.rows('Sessoes').map(({ row, cells }) => {
      const commit = pointer(cells[2]);
      return {
        id: string(cells[0]), tokenHash: string(cells[1]), pointer: commit, revision: commit.revision,
        createdAt: string(cells[3]), expiresAt: string(cells[4]), status: string(cells[5]), row,
      };
    });
  }

  private isActive(session: SessionRecord): boolean {
    const expiry = Date.parse(session.expiresAt);
    if (!Number.isFinite(expiry)) throw storageError();
    return session.status === 'active' && expiry > this.now().getTime();
  }

  private activeSession(id: string): SessionRecord {
    const matches = this.sessionRecords().filter((session) => session.id === id);
    if (matches.length > 1) throw storageError();
    const session = matches[0];
    if (!session || !this.isActive(session)) throw new AppError('Sua sessão de demonstração expirou. Inicie outra demonstração.', 401);
    return session;
  }

  private publicSession(session: SessionRecord): DemoSession {
    return { id: session.id, revision: session.revision, createdAt: session.createdAt, expiresAt: session.expiresAt };
  }

  private commandChain(session: SessionRecord): StoredCommand[] {
    const commands = this.rows('Comandos').filter(({ cells }) => cells[0] === session.id);
    const chain: StoredCommand[] = [];
    const visited = new Set<string>();
    let selected = session.pointer;
    while (true) {
      if (visited.has(selected.snapshotId)) throw storageError();
      visited.add(selected.snapshotId);
      // Não interpreta nem confia em comandos de snapshots órfãos.
      const matches = commands.filter(({ cells }) => cells[1] === selected.snapshotId && number(cells[2]) === selected.revision);
      if (matches.length !== 1) throw storageError();
      const cells = matches[0].cells;
      const command: StoredCommand = {
        snapshotId: string(cells[1]), revision: number(cells[2]), parentSnapshotId: string(cells[3], true),
        commandId: string(cells[4]), resultJson: string(cells[5]), ...optionalField('fingerprint', optionalString(cells[7])),
      };
      chain.push(command);
      if (selected.revision === 0) {
        if (command.parentSnapshotId || command.commandId !== '__init__') throw storageError();
        break;
      }
      if (!command.parentSnapshotId) throw storageError();
      selected = { snapshotId: command.parentSnapshotId, revision: selected.revision - 1 };
    }
    return chain;
  }

  private quota(state: AcademicState, creating: boolean): void {
    const existingRows = Object.keys(SHEET_HEADERS).reduce((sum, name) => sum + Math.max(0, this.port.read(name).length - 1), 0);
    const newRows = state.accounts.length + state.categories.length + state.entries.length + state.plans.length + state.occurrences.length + 2 + (creating ? 1 : 0);
    if (existingRows + newRows > SHEETS_MAX_DATA_ROWS) throw new AppError('O limite de armazenamento desta demonstração foi atingido. Aguarde a limpeza das sessões expiradas.', 429);
  }

  private appendSnapshot(sessionId: string, snapshotId: string, revision: number, state: AcademicState): void {
    for (const items of [state.accounts, state.categories, state.entries, state.plans, state.occurrences]) assertUnique(items);
    const head: Cell[] = [sessionId, snapshotId, revision];
    const append = (name: FinanceSheetName, rows: Cell[][]) => { if (rows.length) this.port.append(name, rows); };
    append('Contas', state.accounts.map((item) => [...head, item.id, item.name, item.type, item.openingBalanceCents, item.createdAt]));
    append('Categorias', state.categories.map((item) => [...head, item.id, item.name, item.kind, item.color]));
    append('Lancamentos', state.entries.map((item) => [...head, item.id, item.description, item.kind, item.amountCents, item.categoryId, item.accountId, item.occurredOn, item.dueOn, item.status, item.paidOn ?? '', item.version, item.createdAt, item.updatedAt, item.isExample ?? '', item.planId ?? '', item.planMonth ?? '', item.isCardPayment ?? '']));
    append('Planejamentos', state.plans.map((item) => [...head, item.id, item.type, item.description, item.amountCents, item.startMonth, item.dueDay, item.categoryId ?? '', item.accountId ?? '', item.cardName ?? '', item.installmentNumber ?? '', item.totalInstallments ?? '', item.endMonth ?? '', item.createdAt, item.updatedAt, item.version, item.archived ?? '', item.archivedFromMonth ?? '']));
    append('RegistrosMensais', state.occurrences.map((item) => [...head, item.id, item.planId, item.month, item.status, item.linkedEntryId ?? '', item.updatedAt, item.snapshot?.type ?? '', item.snapshot?.description ?? '', item.snapshot?.amountCents ?? '', item.snapshot?.dueOn ?? '', item.snapshot?.cardName ?? '', item.snapshot?.installmentNumber ?? '', item.snapshot?.totalInstallments ?? '', item.snapshot?.remainingAfterThisMonth ?? '', item.snapshot?.futureBalanceCents ?? '', item.snapshot?.lastDueOn ?? '']));
    append('Preferencias', [[...head, state.settings.id, state.settings.displayName, state.settings.exampleMode]]);
  }

  createSession(tokenHash: string, state: AcademicState): DemoSession {
    if (typeof tokenHash !== 'string' || !tokenHash || tokenHash.length > 256) throw new AppError('O identificador da sessão é inválido.', 400);
    const previous = this.findSession(tokenHash);
    if (previous) return previous;
    this.quota(state, true);
    const now = this.now();
    const session: DemoSession = { id: this.uuid(), revision: 0, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + SHEETS_SESSION_TTL_MS).toISOString() };
    const commit = { revision: 0, snapshotId: this.uuid() };
    this.appendSnapshot(session.id, commit.snapshotId, 0, state);
    this.port.append('Comandos', [[session.id, commit.snapshotId, 0, '', '__init__', 'null', session.createdAt, '']]);
    this.port.flush();
    this.port.append('Sessoes', [[session.id, tokenHash, JSON.stringify(commit), session.createdAt, session.expiresAt, 'active']]);
    this.port.flush();
    return session;
  }

  findSession(tokenHash: string): DemoSession | undefined {
    const sessions = this.sessionRecords().filter((session) => session.tokenHash === tokenHash && this.isActive(session));
    if (sessions.length > 1) throw storageError();
    return sessions[0] ? this.publicSession(sessions[0]) : undefined;
  }

  load(sessionId: string): LoadedFinanceState {
    const session = this.activeSession(sessionId);
    this.commandChain(session);
    const current = (name: FinanceSheetName) => this.rows(name).filter(({ cells }) => cells[0] === sessionId && cells[1] === session.pointer.snapshotId && number(cells[2]) === session.revision).map(({ cells }) => cells);
    const settings = current('Preferencias');
    if (settings.length !== 1) throw storageError();
    const state: AcademicState = {
      accounts: current('Contas').map(decodeAccount), categories: current('Categorias').map(decodeCategory),
      entries: current('Lancamentos').map(decodeEntry), plans: current('Planejamentos').map(decodePlan), occurrences: current('RegistrosMensais').map(decodeOccurrence),
      settings: { id: string(settings[0][3]) as Preferences['id'], displayName: string(settings[0][4], true), exampleMode: boolean(settings[0][5]) },
    };
    for (const items of [state.accounts, state.categories, state.entries, state.plans, state.occurrences]) assertUnique(items);
    return { state, revision: session.revision };
  }

  findCommand(sessionId: string, commandId: string): { result: unknown; fingerprint?: string } | undefined {
    const session = this.activeSession(sessionId);
    if (commandId === '__init__') return undefined;
    const command = this.commandChain(session).find((item) => item.commandId === commandId);
    if (!command) return undefined;
    let result: unknown;
    try { result = JSON.parse(command.resultJson); } catch { throw storageError(); }
    return { result, ...(command.fingerprint ? { fingerprint: command.fingerprint } : {}) };
  }

  commit(sessionId: string, expectedRevision: number, commandId: string, _before: AcademicState, after: AcademicState, result: unknown, fingerprint?: string): CommitResult {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision === Number.MAX_SAFE_INTEGER
      || typeof commandId !== 'string' || !commandId || commandId.length > 160 || commandId === '__init__'
      || (fingerprint !== undefined && (typeof fingerprint !== 'string' || fingerprint.length > 256))) throw new AppError('A revisão ou o identificador do comando é inválido.', 400);
    const session = this.activeSession(sessionId);
    if (session.revision !== expectedRevision || this.findCommand(sessionId, commandId)) return { applied: false, revision: session.revision };
    let resultJson: string;
    try { resultJson = JSON.stringify(result === undefined ? null : result); } catch { throw new AppError('O resultado do comando não pode ser armazenado.', 400); }
    if (resultJson === undefined || resultJson.length > 50_000) throw new AppError('O resultado do comando excede o limite de armazenamento.', 400);
    this.quota(after, false);
    const next = { revision: expectedRevision + 1, snapshotId: this.uuid() };
    this.appendSnapshot(sessionId, next.snapshotId, next.revision, after);
    this.port.append('Comandos', [[sessionId, next.snapshotId, next.revision, session.pointer.snapshotId, commandId, resultJson, this.now().toISOString(), fingerprint ?? '']]);
    this.port.flush();
    // ScriptLock protege o compare-and-set; a releitura também evita publicar um snapshot já superado.
    const latest = this.activeSession(sessionId);
    if (latest.revision !== expectedRevision || latest.pointer.snapshotId !== session.pointer.snapshotId) return { applied: false, revision: latest.revision };
    this.port.replaceCell('Sessoes', latest.row, 3, JSON.stringify(next));
    this.port.flush();
    return { applied: true, revision: next.revision };
  }

  invalidateSession(sessionId: string): void {
    const matches = this.sessionRecords().filter((session) => session.id === sessionId);
    if (matches.length > 1) throw storageError();
    if (matches[0] && matches[0].status !== 'expired') {
      this.port.replaceCell('Sessoes', matches[0].row, 6, 'expired');
      this.port.flush();
    }
  }

  cleanupExpired(): void {
    const sessions = this.sessionRecords();
    const registered = new Set(sessions.map((session) => session.id));
    const expired = new Set(sessions.filter((session) => !this.isActive(session)).map((session) => session.id));
    const tables: FinanceSheetName[] = ['Contas', 'Categorias', 'Lancamentos', 'Planejamentos', 'RegistrosMensais', 'Preferencias', 'Comandos', 'Sessoes'];
    const stored = new Map(tables.map((name) => [name, this.rows(name)]));
    // Uma criação interrompida pode deixar entidades sem uma linha final em Sessoes.
    // Sob ScriptLock, esses IDs não pertencem a nenhuma criação concorrente.
    for (const name of tables) {
      if (name === 'Sessoes') continue;
      for (const { cells } of stored.get(name)!) {
        const id = string(cells[0]);
        if (!registered.has(id)) expired.add(id);
      }
    }
    if (!expired.size) return;
    for (const name of tables) {
      const rows = stored.get(name)!.filter(({ cells }) => expired.has(string(cells[0]))).map(({ row }) => row).sort((a, b) => b - a);
      for (let index = 0; index < rows.length;) {
        let lowest = rows[index];
        let count = 1;
        while (index + count < rows.length && rows[index + count] === lowest - 1) { lowest -= 1; count += 1; }
        this.port.deleteRows(name, lowest, count);
        index += count;
      }
    }
    this.port.flush();
  }
}
