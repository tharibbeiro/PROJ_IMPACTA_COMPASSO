import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AcademicState } from '../contracts';
import { D1FinanceRepository } from './d1-finance-repository';
import { NodeSqliteDatabase } from './node-sqlite';

const migration = readFileSync(new URL('../../database/migrations/0001_initial.sql', import.meta.url), 'utf8');
const createdAt = '2026-11-14T12:00:00.000Z';
function fixture(): AcademicState {
  return {
    accounts: [{ id: 'account-main', name: 'Conta da demonstração', type: 'bank', openingBalanceCents: 12345, createdAt }],
    categories: [{ id: 'expense-home', name: 'Moradia', kind: 'expense', color: '#087f63' }],
    plans: [{ id: 'plan-home', type: 'fixed', description: 'Conta mensal', amountCents: 9990, startMonth: '2026-11', dueDay: 10, accountId: 'account-main', categoryId: 'expense-home', createdAt, updatedAt: createdAt, version: 1 }],
    entries: [{ id: 'entry-home', description: 'Conta já paga', kind: 'expense', amountCents: 9990, categoryId: 'expense-home', accountId: 'account-main', occurredOn: '2026-11-10', dueOn: '2026-12-05', paidOn: '2026-11-14', status: 'paid', version: 1, createdAt, updatedAt: createdAt, planId: 'plan-home', planMonth: '2026-11' }],
    occurrences: [{ id: 'plan-home:2026-11', planId: 'plan-home', month: '2026-11', status: 'done', linkedEntryId: 'entry-home', updatedAt: createdAt, snapshot: { type: 'fixed', description: 'Conta original', amountCents: 9990, dueOn: '2026-12-05' } }],
    settings: { id: 'preferences', displayName: 'Demonstração', exampleMode: false },
  };
}
let sql: NodeSqliteDatabase;
let repo: D1FinanceRepository;
let now: Date;
beforeEach(() => {
  sql = new NodeSqliteDatabase();
  sql.exec(migration);
  now = new Date(createdAt);
  repo = new D1FinanceRepository(sql, { now: () => now });
});
afterEach(() => sql.close());

describe('persistência SQL e isolamento das demonstrações', () => {
  it('grava entidades em tabelas e recupera centavos, vínculos e retratos mensais', async () => {
    const state = fixture();
    const session = await repo.createSession('hash-of-token-a', state);
    expect(session.revision).toBe(0);
    expect(session.expiresAt).toBe('2026-11-28T12:00:00.000Z');
    expect(await repo.findSession('hash-of-token-a')).toEqual(session);
    expect(await repo.load(session.id)).toEqual({ state, revision: 0 });
    const row = await sql.prepare('SELECT amount_cents, account_id FROM entries WHERE session_id = ?').bind(session.id).first();
    expect(row).toEqual({ amount_cents: 9990, account_id: 'account-main' });
    const columns = (await sql.prepare('PRAGMA table_info(demo_sessions)').all()).results?.map((column) => column.name);
    expect(columns).not.toContain('state_json');
  });

  it('mantém sessões independentes com os mesmos IDs e bloqueia referências de outra sessão', async () => {
    const first = fixture();
    first.accounts.push({ ...first.accounts[0], id: 'private-account', name: 'Exclusiva da sessão A' });
    const a = await repo.createSession('token-a', first);
    const second = fixture();
    second.accounts[0].name = 'Conta da sessão B';
    const b = await repo.createSession('token-b', second);
    expect((await repo.load(a.id)).state.accounts[0].name).toBe(first.accounts[0].name);
    expect((await repo.load(b.id)).state.accounts[0].name).toBe('Conta da sessão B');
    const invalid = structuredClone(second);
    invalid.entries[0].accountId = 'private-account';
    await expect(repo.commit(b.id, 0, 'cross-session', second, invalid, null)).rejects.toThrow();
    expect(await repo.load(b.id)).toEqual({ state: second, revision: 0 });
    expect(await repo.findCommand(b.id, 'cross-session')).toBeUndefined();
  });

  it('usa parâmetros para nomes e mantém o esquema intacto', async () => {
    const state = fixture();
    state.accounts[0].name = "Banco'); DELETE FROM accounts; --";
    const session = await repo.createSession('safe-token', state);
    expect((await repo.load(session.id)).state.accounts[0].name).toBe(state.accounts[0].name);
    expect((await sql.prepare('SELECT count(*) AS count FROM accounts').first<{ count: number }>())?.count).toBe(1);
  });

  it('não mantém sessão parcialmente criada quando uma chave estrangeira é inválida', async () => {
    const invalid = fixture();
    invalid.accounts = [];
    await expect(repo.createSession('invalid-token', invalid)).rejects.toThrow();
    expect(await repo.findSession('invalid-token')).toBeUndefined();
    expect((await sql.prepare('SELECT count(*) AS count FROM demo_sessions').first<{ count: number }>())?.count).toBe(0);
  });
});

describe('concorrência e gravação atômica', () => {
  it('rejeita revisão antiga sem alterar valores nem gravar o comando perdido', async () => {
    const before = fixture(); const session = await repo.createSession('token', before);
    const after = structuredClone(before); after.entries[0].amountCents = 12300; after.entries[0].version = 2;
    expect(await repo.commit(session.id, 0, 'command-a', before, after, { saved: true })).toEqual({ applied: true, revision: 1 });
    const stale = structuredClone(before); stale.entries[0].amountCents = 1;
    expect(await repo.commit(session.id, 0, 'command-b', before, stale, null)).toEqual({ applied: false, revision: 1 });
    expect((await repo.load(session.id)).state).toEqual(after);
    expect(await repo.findCommand(session.id, 'command-b')).toBeUndefined();
  });

  it('repetir o mesmo comando não executa novamente o diff mesmo com a revisão original', async () => {
    const before = fixture(); const session = await repo.createSession('token', before);
    const after = structuredClone(before); after.settings.displayName = 'Nome atualizado';
    const result = { message: 'salvo', amountCents: 9990 };
    const results = await Promise.all([
      repo.commit(session.id, 0, 'same-command', before, after, result),
      repo.commit(session.id, 0, 'same-command', before, after, result),
    ]);
    expect(results.map((r) => r.applied)).toEqual([true, false]);
    expect(await repo.findCommand(session.id, 'same-command')).toEqual({ result });
    expect((await repo.load(session.id)).revision).toBe(1);
    expect((await sql.prepare('SELECT count(*) AS count FROM processed_commands').first<{ count: number }>())?.count).toBe(1);
  });

  it('reverte o CAS e todos os dados se uma gravação posterior falhar', async () => {
    const before = fixture(); const session = await repo.createSession('token', before);
    const invalid = structuredClone(before);
    invalid.settings.displayName = 'Não deve persistir';
    invalid.entries[0].categoryId = 'missing-category';
    await expect(repo.commit(session.id, 0, 'invalid-command', before, invalid, { invalid: true })).rejects.toThrow();
    expect(await repo.load(session.id)).toEqual({ state: before, revision: 0 });
    expect(await repo.findCommand(session.id, 'invalid-command')).toBeUndefined();
  });

  it('substitui contas e registros vinculados sem perder a integridade das referências', async () => {
    const before = fixture(); const session = await repo.createSession('token', before);
    const after = structuredClone(before);
    after.accounts[0].id = 'new-account';
    after.plans[0].accountId = 'new-account';
    after.entries[0].id = 'new-entry'; after.entries[0].accountId = 'new-account';
    after.occurrences[0].linkedEntryId = 'new-entry';
    expect(await repo.commit(session.id, 0, 'replace-state', before, after, null)).toEqual({ applied: true, revision: 1 });
    expect((await repo.load(session.id)).state).toEqual(after);
    expect(await sql.prepare('SELECT id FROM accounts WHERE session_id = ? AND id = ?').bind(session.id, 'account-main').first()).toBeNull();
  });
});

it('expira sessões e remove todas as entidades dependentes na limpeza', async () => {
  const state = fixture(); const session = await repo.createSession('token', state);
  await repo.commit(session.id, 0, 'noop', state, state, null);
  now = new Date('2026-11-29T00:00:00.000Z');
  expect(await repo.findSession('token')).toBeUndefined();
  await expect(repo.load(session.id)).rejects.toMatchObject({ status: 401 });
  await repo.cleanupExpired();
  for (const table of ['demo_sessions', 'accounts', 'categories', 'entries', 'plans', 'plan_occurrences', 'preferences', 'processed_commands']) {
    expect((await sql.prepare(`SELECT count(*) AS count FROM ${table}`).first<{ count: number }>())?.count).toBe(0);
  }
});
