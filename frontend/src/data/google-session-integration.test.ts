import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppsScriptController } from '../../../backend/apps-script';
import { runtimeFixture } from '../../../backend/repositories/google-sheets.fake';
import { accountBalance, monthSummary } from '../../../shared/domain/finance';
import { monthlyPlanningSummary, rowsForMonth } from '../../../shared/domain/planning';

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

  it('atualiza previsão, lista e totais após salvar e recarregar, preservando o recebimento vinculado', async () => {
    const { calls } = applicationBridge();
    const repository = await import('./repository');
    const planning = await import('./planning-repository');
    await repository.initialize();
    const previous = await repository.snapshot();
    const initialPlanning = await planning.getPlanningSnapshot();
    const salary = initialPlanning.plans.find((plan) => plan.description === 'Salário fictício')!;
    const received = previous.entries.find((entry) => entry.planId === salary.id)!;
    const month = salary.startMonth;
    const account = previous.accounts.find((item) => item.id === received.accountId)!;
    const balance = accountBalance(account, previous.entries);
    const notifications = vi.fn();
    const unsubscribe = repository.subscribeState(notifications);
    calls.length = 0;

    try {
      const input = {
        type: salary.type, description: 'Receita extra de teste', amountCents: 20000,
        startMonth: month, dueDay: 30, accountId: salary.accountId, categoryId: salary.categoryId,
      };
      await planning.savePlan(input, salary.id, salary.version, undefined, month);
      expect(notifications).toHaveBeenCalledTimes(1);
      expect(calls).toHaveLength(1);
      const command = JSON.parse(calls[0].args[1] as string);
      expect(command).toMatchObject({ type: 'savePlan', payload: { referenceMonth: month } });

      for (const reload of [false, true]) {
        if (reload) await repository.refreshFromServer();
        const financial = await repository.snapshot();
        const planned = await planning.getPlanningSnapshot();
        const row = rowsForMonth(planned.plans, planned.occurrences, financial.entries, month).find((item) => item.plan.id === salary.id)!;
        expect(row).toMatchObject({ amountCents: 20000, dueOn: `${month}-30`, plan: { description: input.description }, linkedEntry: received });
        expect(monthlyPlanningSummary(planned.plans, planned.occurrences, financial.entries, month).expectedIncomeCents).toBe(147500);
        expect(financial.entries.find((entry) => entry.id === received.id)).toEqual(received);
        expect(accountBalance(account, financial.entries)).toBe(balance);
      }

      await repository.saveEntry({ ...received, description: 'Recebimento corrigido', amountCents: 490000, paidOn: `${month}-06` }, received.id, received.version);
      const financial = await repository.snapshot();
      const planned = await planning.getPlanningSnapshot();
      const row = rowsForMonth(planned.plans, planned.occurrences, financial.entries, month).find((item) => item.plan.id === salary.id)!;
      expect(row).toMatchObject({ amountCents: 20000, dueOn: `${month}-30`, plan: { description: input.description }, linkedEntry: { description: 'Recebimento corrigido', amountCents: 490000, paidOn: `${month}-06` } });
      expect(monthlyPlanningSummary(planned.plans, planned.occurrences, financial.entries, month).expectedIncomeCents).toBe(147500);
    } finally { unsubscribe(); }
  });

  it('confirma e corrige o recebimento na conta escolhida, recalculando o saldo sem duplicar lançamentos', async () => {
    const { calls } = applicationBridge();
    const repository = await import('./repository');
    const planning = await import('./planning-repository');
    await repository.initialize();
    const previous = await repository.snapshot();
    const initialPlanning = await planning.getPlanningSnapshot();
    const plan = initialPlanning.plans.find((item) => item.description === 'Adiantamento fictício')!;
    const pending = previous.entries.find((entry) => entry.planId === plan.id)!;
    expect(pending.status).toBe('pending');
    const month = plan.startMonth;
    const source = previous.accounts.find((account) => account.id === pending.accountId)!;
    const destination = previous.accounts.find((account) => account.id !== source.id)!;
    const originalSource = accountBalance(source, previous.entries);
    const originalDestination = accountBalance(destination, previous.entries);
    const originalSummary = monthSummary(previous.accounts, previous.entries, month);
    const input = {
      type: plan.type, description: plan.description, amountCents: 20000,
      startMonth: month, dueDay: plan.dueDay, accountId: plan.accountId, categoryId: plan.categoryId,
    };
    calls.length = 0;

    let currentPlan = await planning.savePlan(input, plan.id, plan.version, {
      month, completed: true, paidOn: `${month}-10`, amountCents: 20000,
      accountId: destination.id, expectedEntryVersion: pending.version,
    }, month);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].args[1] as string)).toMatchObject({
      type: 'savePlan', payload: { completion: { amountCents: 20000, accountId: destination.id, expectedEntryVersion: pending.version } },
    });
    let financial = await repository.snapshot();
    let received = financial.entries.find((entry) => entry.id === pending.id)!;
    expect(financial.entries).toHaveLength(previous.entries.length);
    expect(received).toMatchObject({ id: pending.id, amountCents: 20000, accountId: destination.id, status: 'paid', paidOn: `${month}-10` });
    expect(accountBalance(source, financial.entries)).toBe(originalSource);
    expect(accountBalance(destination, financial.entries)).toBe(originalDestination + 20000);
    expect(monthSummary(financial.accounts, financial.entries, month)).toMatchObject({
      balanceCents: originalSummary.balanceCents + 20000,
      paidIncomeCents: originalSummary.paidIncomeCents + 20000,
    });

    currentPlan = await planning.savePlan(input, plan.id, currentPlan.version, {
      month, completed: true, paidOn: `${month}-11`, amountCents: 18000,
      accountId: destination.id, expectedEntryVersion: received.version,
    }, month);
    financial = await repository.snapshot();
    received = financial.entries.find((entry) => entry.id === pending.id)!;
    expect(financial.entries).toHaveLength(previous.entries.length);
    expect(received).toMatchObject({ amountCents: 18000, accountId: destination.id, paidOn: `${month}-11` });
    expect(accountBalance(destination, financial.entries)).toBe(originalDestination + 18000);
    expect(monthSummary(financial.accounts, financial.entries, month).balanceCents).toBe(originalSummary.balanceCents + 18000);

    currentPlan = await planning.savePlan(input, plan.id, currentPlan.version, {
      month, completed: true, paidOn: `${month}-11`, amountCents: 18000,
      accountId: source.id, expectedEntryVersion: received.version,
    }, month);
    financial = await repository.snapshot();
    received = financial.entries.find((entry) => entry.id === pending.id)!;
    expect(accountBalance(destination, financial.entries)).toBe(originalDestination);
    expect(accountBalance(source, financial.entries)).toBe(originalSource + 18000);
    expect(monthSummary(financial.accounts, financial.entries, month).balanceCents).toBe(originalSummary.balanceCents + 18000);

    currentPlan = await planning.savePlan({ ...input, amountCents: 25000 }, plan.id, currentPlan.version, undefined, month);
    financial = await repository.snapshot();
    expect(financial.entries.find((entry) => entry.id === pending.id)).toEqual(received);
    expect(accountBalance(source, financial.entries)).toBe(originalSource + 18000);
    const planned = await planning.getPlanningSnapshot();
    expect(rowsForMonth(planned.plans, planned.occurrences, financial.entries, month).find((row) => row.plan.id === plan.id)).toMatchObject({
      amountCents: 25000, linkedEntry: { amountCents: 18000, accountId: source.id, status: 'paid' },
    });

    await planning.savePlan({ ...input, amountCents: 25000 }, plan.id, currentPlan.version, {
      month, completed: false, expectedEntryVersion: received.version,
    }, month);
    await repository.refreshFromServer();
    financial = await repository.snapshot();
    expect(financial.entries).toHaveLength(previous.entries.length);
    expect(financial.entries.find((entry) => entry.id === pending.id)).toMatchObject({ amountCents: 18000, accountId: source.id, status: 'pending' });
    expect(financial.entries.find((entry) => entry.id === pending.id)?.paidOn).toBeUndefined();
    expect(accountBalance(source, financial.entries)).toBe(originalSource);
    expect(accountBalance(destination, financial.entries)).toBe(originalDestination);
    expect(monthSummary(financial.accounts, financial.entries, month)).toMatchObject({
      balanceCents: originalSummary.balanceCents, paidIncomeCents: originalSummary.paidIncomeCents,
    });
  });

  it('confirma pelo registro de recebimento com o valor informado e mantém a atualização depois de recarregar', async () => {
    applicationBridge();
    const repository = await import('./repository');
    const planning = await import('./planning-repository');
    await repository.initialize();
    const before = await repository.snapshot();
    const plans = await planning.getPlanningSnapshot();
    const plan = plans.plans.find((item) => item.description === 'Adiantamento fictício')!;
    const pending = before.entries.find((entry) => entry.planId === plan.id)!;
    const account = before.accounts.find((item) => item.id !== pending.accountId)!;
    const originalBalance = accountBalance(account, before.entries);
    const received = await planning.settlePlan(plan.id, plan.startMonth, {
      amountCents: 20000, accountId: account.id, paidOn: `${plan.startMonth}-10`, expectedEntryVersion: pending.version,
    });
    expect(received).toMatchObject({ id: pending.id, amountCents: 20000, accountId: account.id, status: 'paid' });
    await repository.refreshFromServer();
    const after = await repository.snapshot();
    expect(after.entries).toHaveLength(before.entries.length);
    expect(after.entries.find((entry) => entry.id === pending.id)).toEqual(received);
    expect(accountBalance(account, after.entries)).toBe(originalBalance + 20000);
    expect(monthSummary(after.accounts, after.entries, plan.startMonth).balanceCents).toBe(monthSummary(before.accounts, before.entries, plan.startMonth).balanceCents + 20000);
  });
});
