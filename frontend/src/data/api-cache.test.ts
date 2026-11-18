import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry, EntryInput } from '../domain/types';
import type { AcademicState, StateEnvelope } from './api-client';

type RpcName = 'compassoBootstrap' | 'compassoCreateDemoSession' | 'compassoCommand';
type RpcCall = { method: RpcName; args: Array<string | null> };
type Handler = (call: RpcCall, success: (raw: unknown) => void, failure: () => void) => void;
const TOKEN_A = 'sessao-ficticia-token-aaaaaaaaaaaaaaaa';
const TOKEN_B = 'sessao-ficticia-token-bbbbbbbbbbbbbbbb';
const EXPIRES_AT = '2030-01-01T12:00:00.000Z';
const timestamp = '2026-11-17T12:00:00.000Z';
const baseState = (): AcademicState => ({
  accounts: [{ id: 'demo-account', name: 'Conta fictícia', type: 'bank', openingBalanceCents: 0, createdAt: timestamp }],
  categories: [{ id: 'demo-category', name: 'Outros gastos', kind: 'expense', color: '#087f63' }],
  entries: [], settings: { id: 'preferences', displayName: 'Demonstração', exampleMode: false }, plans: [], occurrences: [],
});
const input: EntryInput = {
  description: 'Despesa fictícia', kind: 'expense', amountCents: 1234, accountId: 'demo-account', categoryId: 'demo-category',
  occurredOn: '2026-11-17', dueOn: '2026-11-17', status: 'pending',
};
const entry: Entry = { ...input, id: 'demo-entry', version: 1, createdAt: timestamp, updatedAt: timestamp };
const response = (state = baseState(), revision = 0, result?: unknown): StateEnvelope => ({ state, revision, result, database: 'Google Sheets', mode: 'demo' });
const createdSession = (token = TOKEN_A, state = baseState(), revision = 0): StateEnvelope => ({ ...response(state, revision), sessionToken: token, sessionExpiresAt: EXPIRES_AT });
let calls: RpcCall[];
let handler: Handler;
let values: Map<string, string>;
let storage: Storage;

function runner(success: (raw: unknown) => void = () => {}, failure: () => void = () => {}): object {
  const invoke = (method: RpcName, args: Array<string | undefined>) => {
    const call: RpcCall = { method, args: JSON.parse(JSON.stringify(args)) as Array<string | null> };
    calls.push(call);
    handler(call, success, failure);
  };
  return {
    withSuccessHandler: (next: (raw: unknown) => void) => runner(next, failure),
    withFailureHandler: (next: () => void) => runner(success, next),
    compassoBootstrap: (token: string) => invoke('compassoBootstrap', [token]),
    compassoCreateDemoSession: (...tokens: string[]) => invoke('compassoCreateDemoSession', tokens),
    compassoCommand: (token: string, json: string) => invoke('compassoCommand', [token, json]),
  };
}

beforeEach(() => {
  vi.resetModules();
  calls = []; values = new Map();
  storage = {
    get length() { return values.size; },
    clear: () => values.clear(), key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => { values.delete(key); }, setItem: (key, value) => { values.set(key, value); },
  };
  handler = ({ method, args }, success) => {
    if (method === 'compassoBootstrap') success(args[0] ? JSON.stringify(response()) : JSON.stringify({ error: 'Sessão ausente.', status: 401 }));
    else if (method === 'compassoCreateDemoSession') success(JSON.stringify(createdSession()));
    else success(JSON.stringify(response()));
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('google', { script: { run: runner() } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Apps Script: sessão e confirmação dos dados', () => {
  it('orienta abrir a implantação quando google.script.run não existe, sem criar exemplos locais', async () => {
    vi.stubGlobal('google', undefined);
    const repository = await import('./repository');
    await expect(repository.initialize()).rejects.toThrow(/endereço de implantação do Google Apps Script/);
    await expect(repository.snapshot()).rejects.toThrow(/Apps Script/);
    expect(calls).toHaveLength(0);
    expect(values.size).toBe(0);
  });

  it('carrega os exemplos do servidor e guarda somente o token e seu prazo', async () => {
    const repository = await import('./repository');
    const api = await import('./api-client');
    await repository.initialize();
    expect(calls.map((call) => call.method)).toEqual(['compassoBootstrap', 'compassoCreateDemoSession']);
    expect((await repository.snapshot()).accounts[0].name).toBe('Conta fictícia');
    expect(api.getSessionInfo()).toEqual({ persistent: true, expiresAt: EXPIRES_AT });
    expect(JSON.parse(storage.getItem('compasso-google-session-v1')!)).toEqual({ token: TOKEN_A, expiresAt: EXPIRES_AT });
    expect(values.size).toBe(1);
    expect([...values.values()].join('')).not.toContain('Conta fictícia');
  });

  it('recupera uma sessão persistida e envia o token apenas como argumento RPC', async () => {
    storage.setItem('compasso-google-session-v1', JSON.stringify({ token: TOKEN_A, expiresAt: EXPIRES_AT }));
    const repository = await import('./repository');
    await repository.initialize();
    expect(calls).toEqual([{ method: 'compassoBootstrap', args: [TOKEN_A] }]);
    expect((await repository.snapshot()).settings.displayName).toBe('Demonstração');
  });

  it('mantém a sessão em memória quando o sandbox bloqueia o armazenamento', async () => {
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('Armazenamento bloqueado.'); },
      setItem() { throw new Error('Armazenamento bloqueado.'); },
    });
    const repository = await import('./repository');
    const api = await import('./api-client');
    await repository.initialize();
    expect(api.getSessionInfo().persistent).toBe(false);
    handler = (_call, success) => success(JSON.stringify(response({ ...baseState(), entries: [entry] }, 1, entry)));
    await expect(repository.saveEntry(input)).resolves.toEqual(entry);
    expect(calls.at(-1)?.args[0]).toBe(TOKEN_A);
    expect((await repository.snapshot()).entries).toEqual([entry]);
  });

  it('atualiza a cópia em memória e os assinantes somente após a confirmação do servidor', async () => {
    const repository = await import('./repository');
    await repository.initialize();
    let confirm!: (raw: unknown) => void;
    handler = (_call, success) => { confirm = success; };
    const notified = vi.fn();
    const unsubscribe = repository.subscribeState(notified);
    const saving = repository.saveEntry(input);
    await vi.waitFor(() => expect(confirm).toBeTypeOf('function'));
    expect((await repository.snapshot()).entries).toHaveLength(0);
    expect(notified).not.toHaveBeenCalled();
    confirm(JSON.stringify(response({ ...baseState(), entries: [entry] }, 1, entry)));
    await expect(saving).resolves.toEqual(entry);
    expect((await repository.snapshot()).entries).toEqual([entry]);
    expect(notified).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('preserva os registros quando o callback de falha da rede é acionado', async () => {
    const repository = await import('./repository');
    await repository.initialize();
    handler = (_call, _success, failure) => failure();
    await expect(repository.saveEntry(input)).rejects.toThrow(/conexão/);
    expect((await repository.snapshot()).entries).toHaveLength(0);
  });

  it('reutiliza o UUID após falha incerta e cria outro depois da confirmação', async () => {
    const repository = await import('./repository');
    await repository.initialize();
    handler = (_call, _success, failure) => failure();
    await expect(repository.saveEntry(input)).rejects.toThrow(/conexão/);
    const first = JSON.parse(calls.at(-1)!.args[1]!);
    handler = (_call, success) => success(JSON.stringify(response({ ...baseState(), entries: [entry] }, 1, entry)));
    await repository.saveEntry(input);
    const second = JSON.parse(calls.at(-1)!.args[1]!);
    expect(second.id).toBe(first.id);
    await repository.saveEntry(input);
    const third = JSON.parse(calls.at(-1)!.args[1]!);
    expect(third.id).not.toBe(first.id);
  });

  it('aguarda confirmação de gravação que ultrapassa os 45 segundos anteriores', async () => {
    const repository = await import('./repository');
    await repository.initialize();
    vi.useFakeTimers();
    let confirm!: (raw: unknown) => void;
    handler = (_call, success) => { confirm = success; };
    let completed = false;
    const saving = repository.saveEntry(input).then((value) => { completed = true; return value; });
    await vi.advanceTimersByTimeAsync(45_001);
    expect(completed).toBe(false);
    expect((await repository.snapshot()).entries).toHaveLength(0);
    confirm(JSON.stringify(response({ ...baseState(), entries: [entry] }, 1, entry)));
    await expect(saving).resolves.toEqual(entry);
    expect((await repository.snapshot()).entries).toEqual([entry]);
  });

  it('mantém a tentativa após prazo de confirmação e reconhece o reenvio sem duplicação', async () => {
    const repository = await import('./repository');
    await repository.initialize(); calls = [];
    vi.useFakeTimers();
    handler = () => {};
    const saving = repository.saveEntry(input);
    const rejection = expect(saving).rejects.toThrow(/pode ter sido concluída/);
    await vi.advanceTimersByTimeAsync(90_001);
    await rejection;
    const previousId = JSON.parse(calls[0].args[1]! as string).id;
    expect((await repository.snapshot()).entries).toHaveLength(0);
    handler = (_call, success) => success(JSON.stringify(response({ ...baseState(), entries: [entry] }, 1, entry)));
    await repository.saveEntry(input);
    expect(JSON.parse(calls.at(-1)!.args[1]! as string).id).toBe(previousId);
    expect((await repository.snapshot()).entries).toEqual([entry]);
  });

  it('não substitui uma revisão recente por resposta antiga', async () => {
    handler = ({ method }, success) => success(JSON.stringify(method === 'compassoBootstrap' ? { error: 'Sem sessão', status: 401 } : createdSession(TOKEN_A, baseState(), 5)));
    const repository = await import('./repository');
    await repository.initialize();
    const older = baseState(); older.settings.displayName = 'Resposta antiga';
    handler = (_call, success) => success(JSON.stringify(response(older, 4)));
    await repository.savePreferences({ displayName: 'Resposta antiga' });
    expect((await repository.snapshot()).settings.displayName).toBe('Demonstração');
  });

  it('mantém a chave de idempotência se a resposta chegar ilegível', async () => {
    const repository = await import('./repository');
    await repository.initialize();
    handler = (_call, success) => success('resposta truncada');
    await expect(repository.saveEntry(input)).rejects.toThrow(/resposta/);
    const first = JSON.parse(calls.at(-1)!.args[1]!);
    handler = (_call, success) => success(JSON.stringify(response({ ...baseState(), entries: [entry] }, 1, entry)));
    await repository.saveEntry(input);
    expect(JSON.parse(calls.at(-1)!.args[1]!).id).toBe(first.id);
    expect((await repository.snapshot()).entries).toHaveLength(1);
  });

  it('serializa os comandos antes de substituir o estado confirmado', async () => {
    const repository = await import('./repository');
    await repository.initialize();
    calls = [];
    let finish!: (raw: unknown) => void;
    handler = (_call, success) => { finish = success; };
    const first = repository.savePreferences({ displayName: 'Primeira alteração' });
    const second = repository.savePreferences({ displayName: 'Segunda alteração' });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(calls).toHaveLength(1);
    const stateOne = baseState(); stateOne.settings.displayName = 'Primeira alteração';
    const stateTwo = baseState(); stateTwo.settings.displayName = 'Segunda alteração';
    handler = (_call, success) => success(JSON.stringify(response(stateTwo, 2)));
    finish(JSON.stringify(response(stateOne, 1)));
    await Promise.all([first, second]);
    expect(calls).toHaveLength(2);
    expect((await repository.snapshot()).settings.displayName).toBe('Segunda alteração');
  });

  it('troca a sessão somente quando o reset remoto é bem-sucedido', async () => {
    const repository = await import('./repository');
    await repository.initialize();
    handler = (_call, _success, failure) => failure();
    await expect(repository.resetExampleData()).rejects.toThrow(/conexão/);
    expect(calls.at(-1)).toEqual({ method: 'compassoCreateDemoSession', args: [TOKEN_A] });
    expect(JSON.parse(storage.getItem('compasso-google-session-v1')!).token).toBe(TOKEN_A);
    const fresh = baseState(); fresh.settings.displayName = 'Nova demonstração';
    handler = (_call, success) => success(JSON.stringify(createdSession(TOKEN_B, fresh, 0)));
    await repository.resetExampleData();
    expect(JSON.parse(storage.getItem('compasso-google-session-v1')!).token).toBe(TOKEN_B);
    expect((await repository.snapshot()).settings.displayName).toBe('Nova demonstração');
  });

  it('renova uma sessão expirada conforme a resposta do servidor', async () => {
    storage.setItem('compasso-google-session-v1', JSON.stringify({ token: TOKEN_A, expiresAt: EXPIRES_AT }));
    handler = ({ method }, success) => success(JSON.stringify(method === 'compassoBootstrap'
      ? { error: 'A sessão expirou.', status: 401 } : createdSession(TOKEN_B)));
    const repository = await import('./repository');
    await repository.initialize();
    expect(calls).toEqual([
      { method: 'compassoBootstrap', args: [TOKEN_A] },
      { method: 'compassoCreateDemoSession', args: [] },
    ]);
    expect(JSON.parse(storage.getItem('compasso-google-session-v1')!).token).toBe(TOKEN_B);
  });

  it('rejeita cópias pessoais antes do RPC e exporta sem incluir o token', async () => {
    const repository = await import('./repository');
    await repository.initialize(); calls = [];
    await expect(repository.restoreBackup(JSON.stringify({ application: 'compasso-financas', version: 2 }))).rejects.toThrow(/Cópias pessoais/);
    expect(calls).toHaveLength(0);
    const backup = await repository.exportBackup();
    expect(JSON.parse(backup).application).toBe('compasso-academico');
    expect(backup).not.toContain(TOKEN_A);
    expect(backup).not.toContain('sessionToken');
  });

  it('exige internet e não cria alterações offline', async () => {
    const repository = await import('./repository');
    await repository.initialize(); calls = [];
    vi.stubGlobal('navigator', { onLine: false });
    await expect(repository.saveEntry(input)).rejects.toThrow(/internet/);
    expect(calls).toHaveLength(0);
    expect((await repository.snapshot()).entries).toHaveLength(0);
  });

  it('propaga conflito do servidor sem alterar os dados em memória', async () => {
    const repository = await import('./repository');
    await repository.initialize();
    handler = (_call, success) => success(JSON.stringify({ error: 'Este registro foi alterado.', status: 409 }));
    await expect(repository.saveEntry(input)).rejects.toMatchObject({ status: 409, message: 'Este registro foi alterado.' });
    expect((await repository.snapshot()).entries).toHaveLength(0);
  });
});
