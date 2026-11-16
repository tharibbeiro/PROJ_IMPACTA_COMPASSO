import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry, EntryInput } from '../domain/types';
import type { AcademicState } from './api-client';
import {
  db, exportBackup, initialize, resetExampleData, restoreBackup, saveEntry, savePreferences, snapshot,
} from './repository';

const timestamp = '2026-11-14T12:00:00.000Z';
const baseState = (): AcademicState => ({
  accounts: [{ id: 'demo-account', name: 'Conta fictícia', type: 'bank', openingBalanceCents: 0, createdAt: timestamp }],
  categories: [{ id: 'demo-category', name: 'Outros gastos', kind: 'expense', color: '#087f63' }],
  entries: [], settings: { id: 'preferences', displayName: 'Demonstração', exampleMode: false }, plans: [], occurrences: [],
});
const input: EntryInput = {
  description: 'Despesa fictícia', kind: 'expense', amountCents: 1234, accountId: 'demo-account', categoryId: 'demo-category',
  occurredOn: '2026-11-14', dueOn: '2026-11-14', status: 'pending',
};
const entry: Entry = { ...input, id: 'demo-entry', version: 1, createdAt: timestamp, updatedAt: timestamp };
const response = (state = baseState(), revision = 0, result?: unknown) => new Response(JSON.stringify({ state, revision, result }), {
  status: 200, headers: { 'Content-Type': 'application/json' },
});
const failure = (status: number, error: string) => new Response(JSON.stringify({ error }), {
  status, headers: { 'Content-Type': 'application/json' },
});

let fetchMock = vi.fn<typeof fetch>();
beforeEach(async () => {
  await db.delete(); await db.open();
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => response());
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });
afterAll(async () => { await db.delete(); });

describe('adaptador HTTP e cache acadêmico', () => {
  it('só confirma o lançamento no cache depois da resposta da API', async () => {
    await initialize(); fetchMock.mockClear();
    let finish!: (value: Response) => void;
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => { started = resolve; });
    fetchMock.mockImplementationOnce(() => { started(); return new Promise<Response>((resolve) => { finish = resolve; }); });
    const saving = saveEntry(input);
    await requestStarted;
    expect((await snapshot()).entries).toHaveLength(0);
    const updated = { ...baseState(), entries: [entry] };
    finish(response(updated, 1, entry));
    await expect(saving).resolves.toEqual(entry);
    expect((await snapshot()).entries).toEqual([entry]);
    expect(await db.operations.count()).toBe(0);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/commands');
    expect(options?.credentials).toBe('same-origin');
    expect(JSON.parse(String(options?.body))).toMatchObject({ type: 'saveEntry', payload: { input } });
  });

  it('sem conexão mantém leitura do cache e rejeita alterações', async () => {
    await initialize();
    fetchMock.mockRejectedValue(new TypeError('Network unavailable'));
    await expect(initialize()).resolves.toBeUndefined();
    expect((await snapshot()).accounts[0].name).toBe('Conta fictícia');
    await expect(saveEntry(input)).rejects.toThrow(/internet/);
    expect((await snapshot()).entries).toHaveLength(0);
    expect(await db.operations.count()).toBe(0);
  });

  it('não cria dados locais quando o primeiro acesso ao servidor falha', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network unavailable'));
    await expect(initialize()).rejects.toThrow(/internet/);
    expect(await db.accounts.count()).toBe(0);
    expect(await db.settings.count()).toBe(0);
    await expect(snapshot()).rejects.toThrow(/primeira vez/);
  });

  it('cria a sessão remota após 401 e não reapresenta cache anterior se a criação falhar', async () => {
    await initialize(); fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(failure(401, 'Sessão ausente')).mockRejectedValueOnce(new TypeError('Network unavailable'));
    await expect(initialize()).rejects.toThrow(/internet/);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/bootstrap', '/api/demo-sessions']);
    fetchMock.mockResolvedValueOnce(failure(401, 'Sessão ausente')).mockResolvedValueOnce(response());
    await expect(initialize()).resolves.toBeUndefined();
  });

  it('não substitui revisão mais nova por uma resposta antiga', async () => {
    fetchMock.mockResolvedValueOnce(response(baseState(), 5));
    await initialize();
    const older = baseState(); older.settings.displayName = 'Resposta antiga';
    fetchMock.mockResolvedValueOnce(response(older, 4));
    await savePreferences({ displayName: 'Resposta antiga' });
    expect((await snapshot()).settings.displayName).toBe('Demonstração');
    expect((await db.metadata.get('server'))?.revision).toBe(5);
  });

  it('serializa alterações e aplica cada resposta antes de iniciar a próxima', async () => {
    await initialize(); fetchMock.mockClear();
    let finish!: (value: Response) => void;
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => { started = resolve; });
    fetchMock.mockImplementationOnce(() => { started(); return new Promise<Response>((resolve) => { finish = resolve; }); });
    const first = savePreferences({ displayName: 'Primeira alteração' });
    const second = savePreferences({ displayName: 'Segunda alteração' });
    await requestStarted;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const stateOne = baseState(); stateOne.settings.displayName = 'Primeira alteração';
    const stateTwo = baseState(); stateTwo.settings.displayName = 'Segunda alteração';
    fetchMock.mockResolvedValueOnce(response(stateTwo, 2));
    finish(response(stateOne, 1));
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await snapshot()).settings.displayName).toBe('Segunda alteração');
  });

  it('rejeita cópias pessoais antes de qualquer envio HTTP', async () => {
    await initialize(); fetchMock.mockClear();
    await expect(restoreBackup(JSON.stringify({ application: 'compasso-financas', version: 2, entries: [{ description: 'Dados pessoais' }] })))
      .rejects.toThrow(/Cópias pessoais/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(await exportBackup()).application).toBe('compasso-academico');
  });

  it('reinicia exemplos por nova sessão no servidor, sem enviar o cache', async () => {
    fetchMock.mockResolvedValueOnce(response(baseState(), 9));
    await initialize(); fetchMock.mockClear();
    const fresh = baseState(); fresh.settings.displayName = 'Nova demonstração';
    fetchMock.mockResolvedValueOnce(response(fresh, 0));
    await resetExampleData();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/demo-sessions');
    expect(JSON.parse(String(options?.body))).toEqual({});
    expect((await snapshot()).settings.displayName).toBe('Nova demonstração');
    expect((await db.metadata.get('server'))?.revision).toBe(0);
  });

  it('preserva o cache quando o servidor rejeita a alteração', async () => {
    await initialize();
    fetchMock.mockResolvedValueOnce(failure(409, 'O registro foi alterado. Atualize antes de salvar.'));
    await expect(saveEntry(input)).rejects.toThrow(/foi alterado/);
    expect((await snapshot()).entries).toHaveLength(0);
  });
});
