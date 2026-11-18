import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppsScriptController } from '../../../backend/apps-script';
import { runtimeFixture } from '../../../backend/repositories/google-sheets.fake';

type Method = 'compassoBootstrap' | 'compassoCreateDemoSession' | 'compassoCommand';
interface Call { method: Method; args: unknown[] }

afterEach(() => { vi.unstubAllGlobals(); });
beforeEach(() => { vi.resetModules(); });

function applicationBridge() {
  const fixture = runtimeFixture();
  const controller = createAppsScriptController(fixture.runtime, fixture.clock);
  expect(JSON.parse(controller.configurar()).configured).toBe(true);
  const values = new Map<string, string>();
  const calls: Call[] = [];
  const runner = (success: (raw: string) => void = () => {}): object => {
    const invoke = (method: Method, args: unknown[]) => {
      // O transporte do Google converte undefined em null dentro dos argumentos.
      const wire = JSON.parse(JSON.stringify(args)) as unknown[];
      calls.push({ method, args: wire });
      const raw = method === 'compassoBootstrap' ? controller.bootstrap(wire[0] as string)
        : method === 'compassoCreateDemoSession' ? controller.createDemoSession(wire[0] as string | undefined)
        : controller.command(wire[0] as string, wire[1] as string);
      queueMicrotask(() => success(raw));
    };
    return {
      withSuccessHandler: (next: (raw: string) => void) => runner(next),
      withFailureHandler: () => runner(success),
      compassoBootstrap: (...args: unknown[]) => invoke('compassoBootstrap', args),
      compassoCreateDemoSession: (...args: unknown[]) => invoke('compassoCreateDemoSession', args),
      compassoCommand: (...args: unknown[]) => invoke('compassoCommand', args),
    };
  };
  vi.stubGlobal('google', { script: { run: runner() } });
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  return { ...fixture, controller, calls, values };
}

describe('primeiro acesso com transporte realista do Apps Script', () => {
  it('cria a sessão, carrega os dados e persiste uma alteração sem enviar argumento ausente', async () => {
    const { calls } = applicationBridge();
    const repository = await import('./repository');
    await repository.initialize();
    expect(calls.slice(0, 2)).toEqual([
      { method: 'compassoBootstrap', args: [''] },
      { method: 'compassoCreateDemoSession', args: [] },
    ]);
    expect((await repository.snapshot()).accounts).toHaveLength(2);
    await repository.addAccount({ name: 'Conta fictícia de integração', type: 'cash', openingBalanceCents: 100 });
    await repository.initialize();
    expect((await repository.snapshot()).accounts.some((account) => account.name === 'Conta fictícia de integração')).toBe(true);
  });

  it('recupera uma sessão vencida sem reenviar o token rejeitado como argumento', async () => {
    const { calls, setNow, values } = applicationBridge();
    const repository = await import('./repository');
    await repository.initialize();
    const previous = JSON.parse(values.get('compasso-google-session-v1')!);
    setNow(new Date(Date.parse(previous.expiresAt) + 1));
    calls.length = 0;
    await repository.initialize();
    expect(calls[0]).toEqual({ method: 'compassoBootstrap', args: [previous.token] });
    expect(calls[1]).toEqual({ method: 'compassoCreateDemoSession', args: [] });
    expect(JSON.parse(values.get('compasso-google-session-v1')!).token).not.toBe(previous.token);
    expect((await repository.snapshot()).accounts).toHaveLength(2);
  });
});
