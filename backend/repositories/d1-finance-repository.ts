import { AppError } from '../contracts';
import type { AcademicState, CommitResult, DemoSession, FinanceRepository, LoadedFinanceState } from '../contracts';
import type { Account, Category, Entry } from '../../shared/domain/types';
import type { PlanItem, PlanOccurrence } from '../../shared/domain/planning-types';
import type { D1Like, D1PreparedStatement, D1Result, SqlValue } from './d1-types';

type SqlRow = Record<string, SqlValue>;
interface RowSpec<T extends { id: string }> {
  table: string;
  columns: readonly string[];
  encode(item: T): SqlValue[];
  decode(row: SqlRow): T;
}
const optional = <T>(value: T | undefined): T | null => value === undefined ? null : value;
const bool = (value: boolean | undefined): number | null => value === undefined ? null : Number(value);
const string = (row: SqlRow, column: string) => String(row[column]);
const number = (row: SqlRow, column: string) => Number(row[column]);
const optionalString = (row: SqlRow, column: string) => row[column] === null || row[column] === undefined ? undefined : String(row[column]);
const optionalNumber = (row: SqlRow, column: string) => row[column] === null || row[column] === undefined ? undefined : Number(row[column]);
const optionalBoolean = (row: SqlRow, column: string) => row[column] === null || row[column] === undefined ? undefined : Boolean(row[column]);
const present = <K extends string, T>(key: K, value: T | undefined): Partial<Record<K, T>> => value === undefined ? {} : { [key]: value } as Record<K, T>;

const accounts: RowSpec<Account> = {
  table: 'accounts', columns: ['id', 'name', 'type', 'opening_balance_cents', 'created_at'],
  encode: (a) => [a.id, a.name, a.type, a.openingBalanceCents, a.createdAt],
  decode: (r) => ({ id: string(r, 'id'), name: string(r, 'name'), type: string(r, 'type') as Account['type'], openingBalanceCents: number(r, 'opening_balance_cents'), createdAt: string(r, 'created_at') }),
};
const categories: RowSpec<Category> = {
  table: 'categories', columns: ['id', 'name', 'kind', 'color'],
  encode: (c) => [c.id, c.name, c.kind, c.color],
  decode: (r) => ({ id: string(r, 'id'), name: string(r, 'name'), kind: string(r, 'kind') as Category['kind'], color: string(r, 'color') }),
};
const plans: RowSpec<PlanItem> = {
  table: 'plans', columns: ['id', 'type', 'description', 'amount_cents', 'start_month', 'due_day', 'category_id', 'account_id', 'card_name', 'installment_number', 'total_installments', 'end_month', 'created_at', 'updated_at', 'version', 'archived', 'archived_from_month'],
  encode: (p) => [p.id, p.type, p.description, p.amountCents, p.startMonth, p.dueDay, optional(p.categoryId), optional(p.accountId), optional(p.cardName), optional(p.installmentNumber), optional(p.totalInstallments), optional(p.endMonth), p.createdAt, p.updatedAt, p.version, bool(p.archived), optional(p.archivedFromMonth)],
  decode: (r) => ({
    id: string(r, 'id'), type: string(r, 'type') as PlanItem['type'], description: string(r, 'description'), amountCents: number(r, 'amount_cents'), startMonth: string(r, 'start_month'), dueDay: number(r, 'due_day'),
    ...present('categoryId', optionalString(r, 'category_id')), ...present('accountId', optionalString(r, 'account_id')), ...present('cardName', optionalString(r, 'card_name')),
    ...present('installmentNumber', optionalNumber(r, 'installment_number')), ...present('totalInstallments', optionalNumber(r, 'total_installments')), ...present('endMonth', optionalString(r, 'end_month')),
    createdAt: string(r, 'created_at'), updatedAt: string(r, 'updated_at'), version: number(r, 'version'), ...present('archived', optionalBoolean(r, 'archived')), ...present('archivedFromMonth', optionalString(r, 'archived_from_month')),
  }),
};
const entries: RowSpec<Entry> = {
  table: 'entries', columns: ['id', 'description', 'kind', 'amount_cents', 'category_id', 'account_id', 'occurred_on', 'due_on', 'status', 'paid_on', 'version', 'created_at', 'updated_at', 'is_example', 'plan_id', 'plan_month', 'is_card_payment'],
  encode: (e) => [e.id, e.description, e.kind, e.amountCents, e.categoryId, e.accountId, e.occurredOn, e.dueOn, e.status, optional(e.paidOn), e.version, e.createdAt, e.updatedAt, bool(e.isExample), optional(e.planId), optional(e.planMonth), bool(e.isCardPayment)],
  decode: (r) => ({
    id: string(r, 'id'), description: string(r, 'description'), kind: string(r, 'kind') as Entry['kind'], amountCents: number(r, 'amount_cents'), categoryId: string(r, 'category_id'), accountId: string(r, 'account_id'), occurredOn: string(r, 'occurred_on'), dueOn: string(r, 'due_on'), status: string(r, 'status') as Entry['status'],
    ...present('paidOn', optionalString(r, 'paid_on')), version: number(r, 'version'), createdAt: string(r, 'created_at'), updatedAt: string(r, 'updated_at'), ...present('isExample', optionalBoolean(r, 'is_example')), ...present('planId', optionalString(r, 'plan_id')), ...present('planMonth', optionalString(r, 'plan_month')), ...present('isCardPayment', optionalBoolean(r, 'is_card_payment')),
  }),
};
const occurrences: RowSpec<PlanOccurrence> = {
  table: 'plan_occurrences', columns: ['id', 'plan_id', 'month', 'status', 'linked_entry_id', 'updated_at', 'snapshot_type', 'snapshot_description', 'snapshot_amount_cents', 'snapshot_due_on', 'snapshot_card_name', 'snapshot_installment_number', 'snapshot_total_installments', 'snapshot_remaining_after_month', 'snapshot_future_balance_cents', 'snapshot_last_due_on'],
  encode: (o) => [o.id, o.planId, o.month, o.status, optional(o.linkedEntryId), o.updatedAt, optional(o.snapshot?.type), optional(o.snapshot?.description), optional(o.snapshot?.amountCents), optional(o.snapshot?.dueOn), optional(o.snapshot?.cardName), optional(o.snapshot?.installmentNumber), optional(o.snapshot?.totalInstallments), optional(o.snapshot?.remainingAfterThisMonth), optional(o.snapshot?.futureBalanceCents), optional(o.snapshot?.lastDueOn)],
  decode: (r) => ({
    id: string(r, 'id'), planId: string(r, 'plan_id'), month: string(r, 'month'), status: string(r, 'status') as PlanOccurrence['status'], ...present('linkedEntryId', optionalString(r, 'linked_entry_id')), updatedAt: string(r, 'updated_at'),
    ...(r.snapshot_type !== null && r.snapshot_type !== undefined ? { snapshot: {
      type: string(r, 'snapshot_type') as PlanItem['type'], description: string(r, 'snapshot_description'), amountCents: number(r, 'snapshot_amount_cents'), dueOn: string(r, 'snapshot_due_on'),
      ...present('cardName', optionalString(r, 'snapshot_card_name')), ...present('installmentNumber', optionalNumber(r, 'snapshot_installment_number')), ...present('totalInstallments', optionalNumber(r, 'snapshot_total_installments')),
      ...present('remainingAfterThisMonth', optionalNumber(r, 'snapshot_remaining_after_month')), ...present('futureBalanceCents', optionalNumber(r, 'snapshot_future_balance_cents')), ...present('lastDueOn', optionalString(r, 'snapshot_last_due_on')),
    } } : {}),
  }),
};

interface Diff<T> { upserts: T[]; deletes: string[]; }
function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  const result = new Map(items.map((item) => [item.id, item]));
  if (result.size !== items.length) throw new AppError('O estado contém identificadores duplicados.');
  return result;
}
function diff<T extends { id: string }>(spec: RowSpec<T>, before: T[], after: T[]): Diff<T> {
  const previous = byId(before); const next = byId(after);
  return {
    upserts: after.filter((item) => !previous.has(item.id) || JSON.stringify(spec.encode(previous.get(item.id)!)) !== JSON.stringify(spec.encode(item))),
    deletes: before.filter((item) => !next.has(item.id)).map((item) => item.id),
  };
}
function readSession(row: SqlRow): DemoSession {
  return { id: string(row, 'id'), revision: number(row, 'revision'), createdAt: string(row, 'created_at'), expiresAt: string(row, 'expires_at') };
}
function checkResults(results: D1Result[]): void {
  if (results.some((result) => result.success === false || result.error)) throw new AppError('Não foi possível salvar os dados da demonstração.', 500);
}

/** Acesso SQL estruturado; os serviços recebem objetos e não executam consultas. */
export class D1FinanceRepository implements FinanceRepository {
  private readonly now: () => Date;
  private readonly ttlMs: number;

  constructor(private readonly database: D1Like, options: { now?: () => Date; ttlMs?: number } = {}) {
    this.now = options.now ?? (() => new Date());
    this.ttlMs = Math.min(options.ttlMs ?? 14 * 24 * 60 * 60 * 1000, 14 * 24 * 60 * 60 * 1000);
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0) throw new Error('O prazo da sessão é inválido.');
  }

  private insert<T extends { id: string }>(spec: RowSpec<T>, sessionId: string, item: T, guard?: { sql: string; values: SqlValue[] }): D1PreparedStatement {
    const columns = ['session_id', ...spec.columns];
    const values: SqlValue[] = [sessionId, ...spec.encode(item)];
    const sql = `INSERT INTO ${spec.table} (${columns.join(', ')}) SELECT ${columns.map(() => '?').join(', ')} WHERE ${guard?.sql ?? '1'} ON CONFLICT(session_id, id) DO UPDATE SET ${spec.columns.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`;
    return this.database.prepare(sql).bind(...values, ...(guard?.values ?? []));
  }

  private remove<T extends { id: string }>(spec: RowSpec<T>, sessionId: string, id: string, guard: { sql: string; values: SqlValue[] }): D1PreparedStatement {
    return this.database.prepare(`DELETE FROM ${spec.table} WHERE session_id = ? AND id = ? AND ${guard.sql}`).bind(sessionId, id, ...guard.values);
  }

  private preferences(sessionId: string, state: AcademicState, guard?: { sql: string; values: SqlValue[] }): D1PreparedStatement {
    return this.database.prepare(`INSERT INTO preferences (session_id, display_name, example_mode) SELECT ?, ?, ? WHERE ${guard?.sql ?? '1'} ON CONFLICT(session_id) DO UPDATE SET display_name = excluded.display_name, example_mode = excluded.example_mode`)
      .bind(sessionId, state.settings.displayName, Number(state.settings.exampleMode), ...(guard?.values ?? []));
  }

  async createSession(tokenHash: string, state: AcademicState): Promise<DemoSession> {
    if (!tokenHash || tokenHash.length > 256) throw new AppError('O identificador da sessão é inválido.');
    for (const values of [state.accounts, state.categories, state.entries, state.plans, state.occurrences]) byId<{ id: string }>(values);
    const now = this.now();
    const session: DemoSession = { id: crypto.randomUUID(), revision: 0, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + this.ttlMs).toISOString() };
    const commands = [this.database.prepare('INSERT INTO demo_sessions (id, token_hash, revision, created_at, expires_at) VALUES (?, ?, 0, ?, ?)').bind(session.id, tokenHash, session.createdAt, session.expiresAt),
      ...state.accounts.map((item) => this.insert(accounts, session.id, item)), ...state.categories.map((item) => this.insert(categories, session.id, item)),
      ...state.plans.map((item) => this.insert(plans, session.id, item)), ...state.entries.map((item) => this.insert(entries, session.id, item)),
      ...state.occurrences.map((item) => this.insert(occurrences, session.id, item)), this.preferences(session.id, state)];
    checkResults(await this.database.batch(commands));
    return session;
  }

  async findSession(tokenHash: string): Promise<DemoSession | undefined> {
    const row = await this.database.prepare('SELECT id, revision, created_at, expires_at FROM demo_sessions WHERE token_hash = ? AND expires_at > ?').bind(tokenHash, this.now().toISOString()).first<SqlRow>();
    return row ? readSession(row) : undefined;
  }

  async load(sessionId: string): Promise<LoadedFinanceState> {
    const queries = ['demo_sessions', 'accounts', 'categories', 'entries', 'plans', 'plan_occurrences', 'preferences'].map((table) => this.database.prepare(table === 'demo_sessions'
      ? 'SELECT id, revision, created_at, expires_at FROM demo_sessions WHERE id = ? AND expires_at > ?'
      : `SELECT * FROM ${table} WHERE session_id = ?`).bind(...(table === 'demo_sessions' ? [sessionId, this.now().toISOString()] : [sessionId])));
    const results = await this.database.batch<SqlRow>(queries);
    checkResults(results);
    const session = results[0].results?.[0]; const prefs = results[6].results?.[0];
    if (!session) throw new AppError('Sua sessão de demonstração expirou. Inicie outra demonstração.', 401);
    if (!prefs) throw new AppError('As preferências da demonstração não foram encontradas.', 500);
    const state: AcademicState = {
      accounts: (results[1].results ?? []).map(accounts.decode), categories: (results[2].results ?? []).map(categories.decode),
      entries: (results[3].results ?? []).map(entries.decode), plans: (results[4].results ?? []).map(plans.decode), occurrences: (results[5].results ?? []).map(occurrences.decode),
      settings: { id: 'preferences', displayName: string(prefs, 'display_name'), exampleMode: Boolean(prefs.example_mode) },
    };
    return { state, revision: number(session, 'revision') };
  }

  async findCommand(sessionId: string, commandId: string): Promise<{ result: unknown } | undefined> {
    const row = await this.database.prepare('SELECT c.result_json FROM processed_commands c JOIN demo_sessions s ON s.id = c.session_id WHERE c.session_id = ? AND c.id = ? AND s.expires_at > ?')
      .bind(sessionId, commandId, this.now().toISOString()).first<SqlRow>();
    return row ? { result: JSON.parse(String(row.result_json)) as unknown } : undefined;
  }

  async commit(sessionId: string, expectedRevision: number, commandId: string, before: AcademicState, after: AcademicState, result: unknown): Promise<CommitResult> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision === Number.MAX_SAFE_INTEGER || !commandId || commandId.length > 160) throw new AppError('A revisão ou o identificador do comando é inválido.');
    const nextRevision = expectedRevision + 1;
    const timestamp = this.now().toISOString();
    const guard = {
      sql: 'EXISTS (SELECT 1 FROM demo_sessions s WHERE s.id = ? AND s.revision = ? AND s.last_command_id = ? AND s.expires_at > ? AND NOT EXISTS (SELECT 1 FROM processed_commands c WHERE c.session_id = s.id AND c.id = ?))',
      values: [sessionId, nextRevision, commandId, timestamp, commandId] as SqlValue[],
    };
    const accountDiff = diff(accounts, before.accounts, after.accounts); const categoryDiff = diff(categories, before.categories, after.categories);
    const planDiff = diff(plans, before.plans, after.plans); const entryDiff = diff(entries, before.entries, after.entries);
    const occurrenceDiff = diff(occurrences, before.occurrences, after.occurrences);
    // Libera vínculos únicos antes de recolocar registros alterados, preservando os demais.
    const changedEntryIds = new Set([...entryDiff.deletes, ...entryDiff.upserts.filter((item) => before.entries.some((old) => old.id === item.id)).map((item) => item.id)]);
    const removedOccurrenceIds = new Set([...occurrenceDiff.deletes, ...occurrenceDiff.upserts.filter((item) => before.occurrences.some((old) => old.id === item.id)).map((item) => item.id), ...before.occurrences.filter((item) => item.linkedEntryId && changedEntryIds.has(item.linkedEntryId)).map((item) => item.id)]);
    const restoredOccurrences = new Map([...occurrenceDiff.upserts, ...after.occurrences.filter((item) => removedOccurrenceIds.has(item.id))].map((item) => [item.id, item]));
    const commands: D1PreparedStatement[] = [this.database.prepare('UPDATE demo_sessions SET revision = ?, last_command_id = ? WHERE id = ? AND revision = ? AND expires_at > ? AND NOT EXISTS (SELECT 1 FROM processed_commands c WHERE c.session_id = demo_sessions.id AND c.id = ?)').bind(nextRevision, commandId, sessionId, expectedRevision, timestamp, commandId),
      ...[...removedOccurrenceIds].map((id) => this.remove(occurrences, sessionId, id, guard)),
      ...[...changedEntryIds].map((id) => this.remove(entries, sessionId, id, guard)),
      ...accountDiff.upserts.map((item) => this.insert(accounts, sessionId, item, guard)), ...categoryDiff.upserts.map((item) => this.insert(categories, sessionId, item, guard)),
      ...planDiff.upserts.map((item) => this.insert(plans, sessionId, item, guard)), ...entryDiff.upserts.map((item) => this.insert(entries, sessionId, item, guard)),
      ...[...restoredOccurrences.values()].map((item) => this.insert(occurrences, sessionId, item, guard)),
      ...planDiff.deletes.map((id) => this.remove(plans, sessionId, id, guard)), ...categoryDiff.deletes.map((id) => this.remove(categories, sessionId, id, guard)), ...accountDiff.deletes.map((id) => this.remove(accounts, sessionId, id, guard)),
    ];
    if (JSON.stringify(before.settings) !== JSON.stringify(after.settings)) commands.push(this.preferences(sessionId, after, guard));
    commands.push(this.database.prepare(`INSERT INTO processed_commands (session_id, id, revision, result_json, created_at) SELECT ?, ?, ?, ?, ? WHERE ${guard.sql}`)
      .bind(sessionId, commandId, nextRevision, JSON.stringify(result === undefined ? null : result), timestamp, ...guard.values));
    commands.push(this.database.prepare('SELECT revision FROM demo_sessions WHERE id = ? AND expires_at > ?').bind(sessionId, timestamp));
    const results = await this.database.batch<SqlRow>(commands);
    checkResults(results);
    const current = results.at(-1)?.results?.[0];
    if (!current) throw new AppError('Sua sessão de demonstração expirou. Inicie outra demonstração.', 401);
    return { applied: results[0].meta?.changes === 1, revision: Number(current.revision) };
  }

  async cleanupExpired(): Promise<void> {
    const result = await this.database.prepare('DELETE FROM demo_sessions WHERE expires_at <= ?').bind(this.now().toISOString()).run();
    checkResults([result]);
  }
}
