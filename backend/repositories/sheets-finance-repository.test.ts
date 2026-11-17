import { describe, expect, it } from 'vitest';
import type { AcademicState } from '../contracts';
import {
  SHEET_HEADERS, SHEETS_MAX_DATA_ROWS, SheetsFinanceRepository,
  type Cell, type SheetsPort,
} from './sheets-finance-repository';

type WriteCall = { operation: 'append' | 'replace' | 'delete'; sheet: string; row?: number; column?: number; count?: number; value?: Cell };

class FakeSheetsPort implements SheetsPort {
  readonly tables = new Map<string, Cell[][]>();
  readonly writes: WriteCall[] = [];
  failAppendSheet?: string;
  failPointer?: 'before' | 'after';
  afterAppend?: (sheet: string) => void;
  flushCalls = 0;
  failFlushCall?: number;

  ensureSheet(name: string, headers: readonly string[]): void {
    if (!this.tables.has(name)) this.tables.set(name, [[...headers]]);
  }

  read(name: string): Cell[][] {
    const rows = this.tables.get(name);
    if (!rows) throw new Error(`Aba não encontrada: ${name}`);
    return rows.map((row) => [...row]);
  }

  append(name: string, rows: Cell[][]): void {
    if (this.failAppendSheet === name) {
      this.failAppendSheet = undefined;
      throw new Error(`Falha simulada ao gravar ${name}`);
    }
    this.writes.push({ operation: 'append', sheet: name, count: rows.length });
    this.tables.get(name)!.push(...rows.map((row) => [...row]));
    this.afterAppend?.(name);
  }

  replaceCell(name: string, row: number, column: number, value: Cell): void {
    const failure = name === 'Sessoes' && column === 3 ? this.failPointer : undefined;
    if (failure) this.failPointer = undefined;
    this.writes.push({ operation: 'replace', sheet: name, row, column, value });
    if (failure === 'before') throw new Error('Falha simulada antes do ponteiro');
    this.tables.get(name)![row - 1][column - 1] = value;
    if (failure === 'after') throw new Error('Falha simulada depois do ponteiro');
  }

  deleteRows(name: string, row: number, count: number): void {
    if (row <= 1) throw new Error('O cabeçalho nunca deve ser removido');
    this.writes.push({ operation: 'delete', sheet: name, row, count });
    this.tables.get(name)!.splice(row - 1, count);
  }

  flush(): void {
    this.flushCalls += 1;
    if (this.flushCalls === this.failFlushCall) {
      this.failFlushCall = undefined;
      throw new Error('Falha simulada no flush');
    }
  }

  pointer(sessionId: string): { revision: number; snapshotId: string } {
    const session = this.read('Sessoes').slice(1).find((row) => row[0] === sessionId);
    if (!session) throw new Error('Sessão não encontrada no teste');
    return JSON.parse(String(session[2]));
  }

  lengths(): Record<string, number> {
    return Object.fromEntries([...this.tables].map(([name, rows]) => [name, rows.length]));
  }
}

const timestamp = '2026-11-17T12:00:00.000Z';

function state(label = 'Turma A'): AcademicState {
  return {
    accounts: [
      { id: 'bank', name: 'Conta fictícia', type: 'bank', openingBalanceCents: -3210, createdAt: timestamp },
      { id: 'cash', name: 'Carteira fictícia', type: 'cash', openingBalanceCents: 9000, createdAt: timestamp },
    ],
    categories: [
      { id: 'income', name: 'Receita de exemplo', kind: 'income', color: '#123abc' },
      { id: 'expense', name: 'Gasto de exemplo', kind: 'expense', color: '#abcdef' },
    ],
    entries: [
      { id: 'received', description: 'Recebimento fictício', kind: 'income', amountCents: 23000, categoryId: 'income', accountId: 'bank', occurredOn: '2026-11-05', dueOn: '2026-12-02', status: 'paid', paidOn: '2026-11-10', version: 2, createdAt: timestamp, updatedAt: timestamp, planId: 'salary', planMonth: '2026-11', isExample: false },
      { id: 'invoice', description: 'Fatura fictícia já prevista', kind: 'expense', amountCents: 3800, categoryId: 'expense', accountId: 'bank', occurredOn: '2026-11-10', dueOn: '2026-11-10', status: 'paid', paidOn: '2026-11-10', version: 1, createdAt: timestamp, updatedAt: timestamp, isCardPayment: true },
      { id: 'pending', description: 'Conta fictícia pendente', kind: 'expense', amountCents: 1234, categoryId: 'expense', accountId: 'cash', occurredOn: '2026-11-17', dueOn: '2026-11-25', status: 'pending', version: 1, createdAt: timestamp, updatedAt: timestamp },
    ],
    settings: { id: 'preferences', displayName: label, exampleMode: false },
    plans: [
      { id: 'salary', type: 'salary', description: 'Receita mensal fictícia', amountCents: 24000, startMonth: '2026-11', dueDay: 5, accountId: 'bank', categoryId: 'income', version: 2, createdAt: timestamp, updatedAt: timestamp, endMonth: '2027-12', archived: false },
      { id: 'purchase', type: 'installment', description: 'Compra fictícia', amountCents: 1900, startMonth: '2026-11', dueDay: 31, cardName: 'Cartão fictício', installmentNumber: 2, totalInstallments: 4, version: 1, createdAt: timestamp, updatedAt: timestamp },
      { id: 'reserve', type: 'reserve', description: 'Reserva fictícia encerrada', amountCents: 500, startMonth: '2026-10', dueDay: 1, version: 2, createdAt: timestamp, updatedAt: timestamp, archived: true, archivedFromMonth: '2026-12' },
    ],
    occurrences: [
      { id: 'salary:2026-11', planId: 'salary', month: '2026-11', status: 'done', linkedEntryId: 'received', updatedAt: timestamp, snapshot: { type: 'salary', description: 'Receita fictícia da época', amountCents: 23000, dueOn: '2026-12-02' } },
      { id: 'purchase:2026-11', planId: 'purchase', month: '2026-11', status: 'done', updatedAt: timestamp, snapshot: { type: 'installment', description: 'Compra fictícia da época', amountCents: 1900, dueOn: '2026-11-30', cardName: 'Cartão fictício', installmentNumber: 2, totalInstallments: 4, remainingAfterThisMonth: 2, futureBalanceCents: 3800, lastDueOn: '2027-01-31' } },
      { id: 'reserve:2026-11', planId: 'reserve', month: '2026-11', status: 'pending', updatedAt: timestamp },
    ],
  };
}

function setup() {
  const port = new FakeSheetsPort();
  let nextId = 0;
  let now = new Date(timestamp);
  const repository = new SheetsFinanceRepository(port, () => new Date(now), () => `uuid-${++nextId}`);
  return { port, repository, setNow: (iso: string) => { now = new Date(iso); } };
}

function changed(original: AcademicState, label: string): AcademicState {
  const updated = structuredClone(original);
  updated.settings.displayName = label;
  updated.entries[2].amountCents += 100;
  return updated;
}

describe('persistência em planilhas com publicação por ponteiro', () => {
  it('faz roundtrip inicial de todas as entidades, campos opcionais e snapshots achatados', () => {
    const { port, repository } = setup();
    const initial = state();
    const session = repository.createSession('hash-a', initial);
    expect(repository.findSession('hash-a')).toEqual(session);
    expect(repository.load(session.id)).toEqual({ state: initial, revision: 0 });
    expect(session.expiresAt).toBe('2026-11-24T12:00:00.000Z');
    expect(Object.keys(SHEET_HEADERS).sort()).toEqual(['Categorias', 'Comandos', 'Contas', 'Lancamentos', 'Planejamentos', 'Preferencias', 'RegistrosMensais', 'Sessoes'].sort());
    expect(port.read('RegistrosMensais')[1].slice(0, 3)).toEqual([session.id, port.pointer(session.id).snapshotId, 0]);
    expect(port.read('RegistrosMensais')[0]).toContain('snapshotAmountCents');
    const loaded = repository.load(session.id);
    loaded.state.entries[0].amountCents = 1;
    expect(repository.load(session.id).state.entries[0].amountCents).toBe(23000);
  });

  it('isola sessões diferentes mesmo quando usam os mesmos IDs de entidades', () => {
    const { repository } = setup();
    const first = repository.createSession('hash-a', state('Turma A'));
    const second = repository.createSession('hash-b', state('Turma B'));
    const secondBefore = repository.load(second.id).state;
    const firstBefore = repository.load(first.id).state;
    const firstAfter = changed(firstBefore, 'Turma A alterada');
    expect(repository.commit(first.id, 0, 'command-a', firstBefore, firstAfter, { ok: true })).toEqual({ applied: true, revision: 1 });
    expect(repository.load(first.id).state).toEqual(firstAfter);
    expect(repository.load(second.id)).toEqual({ state: secondBefore, revision: 0 });
    expect(repository.findCommand(second.id, 'command-a')).toBeUndefined();
  });

  it('mantém o estado publicado e permite repetir a gravação após falha em cada aba', () => {
    for (const failingSheet of ['Contas', 'Categorias', 'Lancamentos', 'Planejamentos', 'RegistrosMensais', 'Preferencias', 'Comandos']) {
      const { port, repository } = setup();
      const initial = state();
      const session = repository.createSession('hash', initial);
      const pointer = port.pointer(session.id);
      const after = changed(initial, `Tentativa em ${failingSheet}`);
      port.failAppendSheet = failingSheet;
      expect(() => repository.commit(session.id, 0, 'failed', initial, after, { ok: true })).toThrow('Falha simulada');
      expect(port.pointer(session.id)).toEqual(pointer);
      expect(repository.load(session.id)).toEqual({ state: initial, revision: 0 });
      expect(repository.findCommand(session.id, 'failed')).toBeUndefined();
      expect(repository.commit(session.id, 0, 'failed', initial, after, { ok: true })).toEqual({ applied: true, revision: 1 });
      expect(repository.load(session.id).state).toEqual(after);
    }
  });

  it('ignora comandos órfãos e usa um snapshot novo ao tentar outra gravação na mesma revisão', () => {
    const { port, repository } = setup();
    const initial = state();
    const session = repository.createSession('hash', initial);
    port.failPointer = 'before';
    expect(() => repository.commit(session.id, 0, 'orphan-command', initial, changed(initial, 'Órfão'), { origin: 'orphan' })).toThrow('antes do ponteiro');
    const staged = port.read('Comandos').slice(1).find((row) => row[4] === 'orphan-command');
    expect(staged).toBeDefined();
    expect(repository.findCommand(session.id, 'orphan-command')).toBeUndefined();
    const next = changed(initial, 'Publicado');
    expect(repository.commit(session.id, 0, 'successful-command', initial, next, { origin: 'published' })).toEqual({ applied: true, revision: 1 });
    expect(port.pointer(session.id).snapshotId).not.toBe(staged![1]);
    expect(repository.findCommand(session.id, 'orphan-command')).toBeUndefined();
    expect(repository.findCommand(session.id, 'successful-command')).toEqual({ result: { origin: 'published' } });
    expect(repository.load(session.id).state).toEqual(next);
  });

  it('detecta confirmação perdida depois da troca do ponteiro e não reaplica o comando', () => {
    const { port, repository } = setup();
    const initial = state();
    const session = repository.createSession('hash', initial);
    const after = changed(initial, 'Confirmado');
    port.failPointer = 'after';
    expect(() => repository.commit(session.id, 0, 'published', initial, after, { id: 'result' })).toThrow('depois do ponteiro');
    expect(repository.load(session.id)).toEqual({ state: after, revision: 1 });
    expect(repository.findCommand(session.id, 'published')).toEqual({ result: { id: 'result' } });
    const lengths = port.lengths();
    expect(repository.commit(session.id, 1, 'published', after, changed(after, 'Não reaplicar'), { other: true })).toEqual({ applied: false, revision: 1 });
    expect(port.lengths()).toEqual(lengths);
  });

  it('não publica o snapshot quando o flush do staging falha', () => {
    const { port, repository } = setup();
    const initial = state();
    const session = repository.createSession('hash', initial);
    const pointer = port.pointer(session.id);
    port.failFlushCall = port.flushCalls + 1;
    const after = changed(initial, 'Staging ainda não confirmado');
    expect(() => repository.commit(session.id, 0, 'flush-stage', initial, after, { ok: true })).toThrow('flush');
    expect(port.pointer(session.id)).toEqual(pointer);
    expect(repository.load(session.id)).toEqual({ state: initial, revision: 0 });
    expect(repository.findCommand(session.id, 'flush-stage')).toBeUndefined();
    expect(repository.commit(session.id, 0, 'flush-stage', initial, after, { ok: true })).toEqual({ applied: true, revision: 1 });
    expect(repository.load(session.id).state).toEqual(after);
  });

  it('reconhece o comando publicado quando o flush posterior ao ponteiro falha', () => {
    const { port, repository } = setup();
    const initial = state();
    const session = repository.createSession('hash', initial);
    const after = changed(initial, 'Ponteiro já alterado');
    port.failFlushCall = port.flushCalls + 2;
    expect(() => repository.commit(session.id, 0, 'flush-published', initial, after, { confirmed: true })).toThrow('flush');
    expect(repository.load(session.id)).toEqual({ state: after, revision: 1 });
    expect(repository.findCommand(session.id, 'flush-published')).toEqual({ result: { confirmed: true } });
    const lengths = port.lengths();
    expect(repository.commit(session.id, 1, 'flush-published', after, initial, {})).toEqual({ applied: false, revision: 1 });
    expect(port.lengths()).toEqual(lengths);
  });

  it('encontra comandos ancestrais e seu fingerprint depois de commits posteriores', () => {
    const { port, repository } = setup();
    const initial = state();
    const session = repository.createSession('hash', initial);
    const first = changed(initial, 'Primeiro');
    const second = changed(first, 'Segundo');
    expect(repository.commit(session.id, 0, 'first', initial, first, { first: true }, 'fingerprint-first').applied).toBe(true);
    expect(repository.commit(session.id, 1, 'second', first, second, undefined).applied).toBe(true);
    expect(repository.findCommand(session.id, 'first')).toEqual({ result: { first: true }, fingerprint: 'fingerprint-first' });
    expect(repository.findCommand(session.id, 'second')).toEqual({ result: null });
    const lengths = port.lengths();
    expect(repository.commit(session.id, 2, 'first', second, initial, { replay: true })).toEqual({ applied: false, revision: 2 });
    expect(port.lengths()).toEqual(lengths);
  });

  it('retorna conflito de revisão sem acrescentar linhas nem alterar o ponteiro', () => {
    const { port, repository } = setup();
    const initial = state();
    const session = repository.createSession('hash', initial);
    const lengths = port.lengths();
    const pointer = port.pointer(session.id);
    expect(repository.commit(session.id, 7, 'stale', initial, changed(initial, 'Conflito'), {})).toEqual({ applied: false, revision: 0 });
    expect(port.lengths()).toEqual(lengths);
    expect(port.pointer(session.id)).toEqual(pointer);
  });

  it('reconfere o ponteiro antes de publicar e não sobrescreve uma revisão já avançada', () => {
    const { port, repository } = setup();
    const initial = state();
    const session = repository.createSession('hash', initial);
    const competing = changed(initial, 'Revisão concorrente já publicada');
    port.afterAppend = (sheet) => {
      if (sheet !== 'Comandos') return;
      port.afterAppend = undefined;
      expect(repository.commit(session.id, 0, 'competing', initial, competing, { winner: true })).toEqual({ applied: true, revision: 1 });
    };
    expect(repository.commit(session.id, 0, 'staged', initial, changed(initial, 'Não sobrescrever'), { winner: false })).toEqual({ applied: false, revision: 1 });
    expect(repository.load(session.id)).toEqual({ state: competing, revision: 1 });
    expect(repository.findCommand(session.id, 'staged')).toBeUndefined();
    expect(repository.findCommand(session.id, 'competing')).toEqual({ result: { winner: true } });
  });

  it('mantém textos literais e datas civis na porta lógica sem modificar o conteúdo', () => {
    const { repository } = setup();
    const initial = state();
    initial.accounts[0].name = "'=SUM(1,2)";
    initial.categories[0].name = '+123';
    initial.entries[0].description = '=HYPERLINK("https://example.invalid")';
    initial.entries[1].description = '-texto';
    initial.entries[2].description = '@texto';
    initial.settings.displayName = '  2026-01-01  ';
    initial.plans[0].description = '\u2060texto com marcador original';
    const session = repository.createSession('hash', initial);
    expect(repository.load(session.id).state).toEqual(initial);
  });

  it('expira em sete dias e invalida uma sessão sem modificar os dados de outra', () => {
    const { repository, setNow } = setup();
    const first = repository.createSession('hash-a', state('A'));
    const second = repository.createSession('hash-b', state('B'));
    repository.invalidateSession(first.id);
    expect(repository.findSession('hash-a')).toBeUndefined();
    expect(() => repository.load(first.id)).toThrow();
    expect(repository.load(second.id).state.settings.displayName).toBe('B');
    setNow('2026-11-24T12:00:00.000Z');
    expect(repository.findSession('hash-b')).toBeUndefined();
    expect(() => repository.load(second.id)).toThrow();
  });

  it('remove fisicamente apenas sessões vencidas ou invalidadas com exclusões descendentes', () => {
    const { port, repository, setNow } = setup();
    const first = repository.createSession('hash-expired', state('Expirada'));
    setNow('2026-11-18T12:00:00.000Z');
    const active = repository.createSession('hash-active', state('Ativa'));
    const invalidated = repository.createSession('hash-invalid', state('Invalidada'));
    const firstState = repository.load(first.id).state;
    repository.commit(first.id, 0, 'old', firstState, changed(firstState, 'Histórico expirado'), {});
    const beforeActive = repository.load(active.id);
    repository.invalidateSession(invalidated.id);
    setNow('2026-11-24T12:00:00.000Z');
    const deletesStart = port.writes.length;
    repository.cleanupExpired();
    expect(repository.load(active.id)).toEqual(beforeActive);
    expect(repository.findSession('hash-active')).toEqual(active);
    for (const name of Object.keys(SHEET_HEADERS)) {
      const rows = port.read(name).slice(1);
      expect(rows.every((row) => row[0] !== first.id && row[0] !== invalidated.id)).toBe(true);
    }
    const deletions = port.writes.slice(deletesStart).filter((call) => call.operation === 'delete');
    expect(deletions.length).toBeGreaterThan(0);
    expect(deletions.at(-1)?.sheet).toBe('Sessoes');
    for (const name of Object.keys(SHEET_HEADERS)) {
      const rows = deletions.filter((call) => call.sheet === name).map((call) => call.row!);
      expect(rows).toEqual([...rows].sort((a, b) => b - a));
    }
  });

  it('limpa dados de uma criação incompleta sem remover a sessão ativa existente', () => {
    const { port, repository } = setup();
    const healthyState = state('Sessão ativa preservada');
    const healthy = repository.createSession('hash-healthy', healthyState);
    const originalRows = Object.fromEntries(Object.keys(SHEET_HEADERS).map((name) => [name, port.read(name)]));
    port.failAppendSheet = 'Sessoes';
    expect(() => repository.createSession('hash-incomplete', state('Criação incompleta'))).toThrow('Falha simulada');
    expect(repository.findSession('hash-incomplete')).toBeUndefined();
    const orphanIds = new Set(port.read('Contas').slice(1).filter((row) => row[0] !== healthy.id).map((row) => row[0]));
    expect(orphanIds.size).toBe(1);
    expect(port.read('Comandos').slice(1).some((row) => orphanIds.has(row[0]))).toBe(true);

    repository.cleanupExpired();

    expect(repository.load(healthy.id)).toEqual({ state: healthyState, revision: 0 });
    expect(repository.findSession('hash-healthy')).toEqual(healthy);
    for (const name of Object.keys(SHEET_HEADERS)) expect(port.read(name)).toEqual(originalRows[name]);
  });

  it('recusa novos snapshots quando a quota global de linhas físicas está esgotada', () => {
    const { port, repository } = setup();
    const initial = state();
    const session = repository.createSession('hash', initial);
    const commands = port.tables.get('Comandos')!;
    commands.push(...Array.from({ length: SHEETS_MAX_DATA_ROWS }, (_, index): Cell[] => ['other-session', `other-${index}`, 0, '', '__init__', 'null', timestamp, '']));
    const lengths = port.lengths();
    let error: unknown;
    try { repository.commit(session.id, 0, 'quota', initial, changed(initial, 'Não cabe'), {}); }
    catch (caught) { error = caught; }
    expect(error).toMatchObject({ status: 429 });
    expect(port.lengths()).toEqual(lengths);
    expect(repository.load(session.id).revision).toBe(0);
  });
});
