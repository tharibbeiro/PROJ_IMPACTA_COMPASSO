import { describe, expect, it } from 'vitest';
import { AppError, type AcademicState, type FinanceCommand } from '../contracts';
import { accountBalance, monthSummary } from '../../shared/domain/finance';
import { monthlyPlanningSummary, rowsForMonth } from '../../shared/domain/planning';
import type { Entry, EntryInput } from '../../shared/domain/types';
import type { PlanInput, PlanItem, PlanOccurrence } from '../../shared/domain/planning-types';
import { FinanceService } from './finance-service';
import { createDemoState } from './demo-state';

const now = new Date('2026-11-14T12:00:00.000Z');
const service = new FinanceService(() => now);
const base = (): AcademicState => ({
  accounts: [{ id: 'account', name: 'Conta de teste', type: 'bank', openingBalanceCents: 100000, createdAt: now.toISOString() }],
  categories: [
    { id: 'expense', name: 'Despesa', kind: 'expense', color: '#123abc' },
    { id: 'income', name: 'Receita', kind: 'income', color: '#456def' },
  ],
  entries: [], plans: [], occurrences: [], settings: { id: 'preferences', displayName: 'Teste', exampleMode: false },
});
const entryInput = (): EntryInput => ({ description: 'Compra de teste', kind: 'expense', amountCents: 7654, categoryId: 'expense', accountId: 'account', occurredOn: '2026-11-14', dueOn: '2026-11-20', status: 'pending' });
const planInput = (): PlanInput => ({ type: 'fixed', description: 'Conta prevista', amountCents: 12345, startMonth: '2026-11', dueDay: 20, accountId: 'account', categoryId: 'expense' });
function run<T = unknown>(state: AcademicState, type: string, payload: FinanceCommand['payload']) {
  const result = service.apply(state, { id: crypto.randomUUID(), type, payload });
  return { state: result.state, result: result.result as T };
}

describe('FinanceService: regras e isolamento', () => {
  it('usa cópia defensiva e valida tipo, categoria, conta e valor antes de retornar alterações', () => {
    const state = base();
    const created = run<Entry>(state, 'saveEntry', { input: entryInput() });
    expect(state.entries).toHaveLength(0);
    expect(created.state.entries).toHaveLength(1);
    created.result.description = 'Objeto externo';
    expect(created.state.entries[0].description).toBe('Compra de teste');
    for (const input of [{ ...entryInput(), amountCents: -1 }, { ...entryInput(), amountCents: 1.2 }, { ...entryInput(), categoryId: 'income' }, { ...entryInput(), accountId: 'missing' }]) {
      expect(() => run(state, 'saveEntry', { input })).toThrow(AppError);
    }
    expect(state.entries).toHaveLength(0);
  });

  it('devolve conflito 409 para edição antiga e preserva versão e valores anteriores', () => {
    const first = run<Entry>(base(), 'saveEntry', { input: entryInput() });
    const updated = run<Entry>(first.state, 'saveEntry', { input: { ...entryInput(), amountCents: 9000 }, id: first.result.id, expectedVersion: 1 });
    expect(updated.result.version).toBe(2);
    try {
      run(updated.state, 'saveEntry', { input: entryInput(), id: first.result.id, expectedVersion: 1 });
      throw new Error('Conflito esperado');
    } catch (error) { expect(error).toMatchObject({ status: 409 }); }
    expect(updated.state.entries[0].amountCents).toBe(9000);
    expect(() => run(updated.state, 'deleteEntry', { id: first.result.id, expectedVersion: 1 })).toThrow('alterado');
  });

  it('repetir pagamento não cria outro lançamento nem incrementa a versão novamente', () => {
    const first = run<Entry>(base(), 'saveEntry', { input: entryInput() });
    const paid = run<Entry>(first.state, 'settleEntry', { id: first.result.id, expectedVersion: 1 });
    const duplicate = run<Entry>(paid.state, 'settleEntry', { id: first.result.id, expectedVersion: 1 });
    expect(duplicate.state.entries).toHaveLength(1);
    expect(duplicate.result).toEqual(paid.result);
    expect(duplicate.result.version).toBe(2);
    expect(accountBalance(duplicate.state.accounts[0], duplicate.state.entries)).toBe(92346);
  });

  it('edita conta existente mantendo identidade e lançamentos anteriores', () => {
    const created = run<Entry>(base(), 'saveEntry', { input: entryInput() });
    const updated = run(created.state, 'updateAccount', { id: 'account', input: { name: 'Novo nome', type: 'cash', openingBalanceCents: -1000 } });
    expect(updated.state.accounts[0]).toMatchObject({ id: 'account', name: 'Novo nome', openingBalanceCents: -1000, createdAt: now.toISOString() });
    expect(updated.state.entries).toEqual(created.state.entries);
  });

  it('registra e quita plano uma única vez mantendo a previsão no orçamento', () => {
    const planned = run<PlanItem>(base(), 'savePlan', { input: planInput() });
    const issued = run<Entry>(planned.state, 'realizePlan', { planId: planned.result.id, month: '2026-11' });
    const repeated = run<Entry>(issued.state, 'realizePlan', { planId: planned.result.id, month: '2026-11' });
    expect(repeated.result.id).toBe(issued.result.id);
    const paid = run<Entry>(repeated.state, 'settlePlan', { planId: planned.result.id, month: '2026-11' });
    const again = run<Entry>(paid.state, 'settlePlan', { planId: planned.result.id, month: '2026-11' });
    expect(again.result).toEqual(paid.result);
    expect(again.state.occurrences[0]).toMatchObject({ status: 'done', linkedEntryId: paid.result.id });
    const summary = monthlyPlanningSummary(again.state.plans, again.state.occurrences, again.state.entries, '2026-11');
    expect(summary.fixedCents).toBe(12345);
    expect(summary.variableCents).toBe(0);
  });

  it('vincula lançamento manual e preserva o vínculo ao editar ou excluir', () => {
    const planned = run<PlanItem>(base(), 'savePlan', { input: planInput() });
    const manual = run<Entry>(planned.state, 'saveEntry', { input: { ...entryInput(), dueOn: '2026-12-15' } });
    const linked = run<Entry>(manual.state, 'linkPlanEntry', { planId: planned.result.id, month: '2026-11', entryId: manual.result.id, expectedVersion: 1 });
    expect(linked.state.entries).toHaveLength(1);
    const edited = run<Entry>(linked.state, 'saveEntry', { input: { ...entryInput(), amountCents: 8000 }, id: linked.result.id, expectedVersion: linked.result.version });
    expect(edited.result.planId).toBe(planned.result.id);
    const deleted = run(edited.state, 'deleteEntry', { id: edited.result.id, expectedVersion: edited.result.version });
    expect(deleted.state.occurrences[0].linkedEntryId).toBeUndefined();
    expect(deleted.state.occurrences[0].status).toBe('pending');
    expect(deleted.state.entries).toHaveLength(0);
  });

  it('conferir cartão e separar reserva não movimenta banco e congela o mês histórico', () => {
    const initial: PlanInput = { type: 'cardFixed', description: 'Assinatura original', amountCents: 4567, startMonth: '2026-11', dueDay: 18, cardName: 'Cartão fictício' };
    const planned = run<PlanItem>(base(), 'savePlan', { input: initial });
    const checked = run<PlanOccurrence>(planned.state, 'setPlanningChecked', { planId: planned.result.id, month: '2026-11', checked: true });
    const changed = run<PlanItem>(checked.state, 'savePlan', { id: planned.result.id, expectedVersion: 1, referenceMonth: '2026-12', input: { ...initial, description: 'Nova descrição', amountCents: 8000, dueDay: 28 } });
    const ended = run(changed.state, 'deletePlan', { id: planned.result.id, expectedVersion: changed.result.version, fromMonth: '2026-11' });
    const rows = rowsForMonth(ended.state.plans, ended.state.occurrences, ended.state.entries, '2026-11');
    expect(rows[0]).toMatchObject({ amountCents: 4567, dueOn: '2026-11-18', plan: { description: 'Assinatura original' } });
    const reserve = run<PlanItem>(ended.state, 'savePlan', { input: { type: 'reserve', description: 'Reserva', amountCents: 20000, startMonth: '2026-11', dueDay: 25 } });
    const separated = run(reserve.state, 'setPlanningChecked', { planId: reserve.result.id, month: '2026-11', checked: true });
    expect(separated.state.entries).toHaveLength(0);
    expect(accountBalance(separated.state.accounts[0], separated.state.entries)).toBe(100000);
    expect(monthlyPlanningSummary(separated.state.plans, separated.state.occurrences, [], '2026-11').reserveCents).toBe(20000);
  });

  it('pagamento de fatura mantém saída de caixa sem duplicar despesas previstas no cartão', () => {
    const planned = run<PlanItem>(base(), 'savePlan', { input: { type: 'cardFixed', description: 'Assinatura', amountCents: 4567, startMonth: '2026-11', dueDay: 18, cardName: 'Cartão' } });
    const paid = run<Entry>(planned.state, 'saveEntry', { input: { ...entryInput(), amountCents: 4567, status: 'paid', paidOn: '2026-11-14', isCardPayment: true } });
    const summary = monthlyPlanningSummary(paid.state.plans, paid.state.occurrences, paid.state.entries, '2026-11');
    expect(summary.cardFixedCents).toBe(4567);
    expect(summary.variableCents).toBe(0);
    expect(accountBalance(paid.state.accounts[0], paid.state.entries)).toBe(95433);
    const cleared = run<Entry>(paid.state, 'saveEntry', { input: { ...paid.result, isCardPayment: false }, id: paid.result.id, expectedVersion: paid.result.version });
    expect(cleared.result.isCardPayment).toBeUndefined();
  });

  it('rejeita restauração pessoal e excesso de registros sem alterar o estado recebido', () => {
    const state = base();
    expect(() => run(state, 'restoreBackup', { raw: { application: 'compasso-financas', version: 2 } })).toThrow(/Acadêmico/);
    const full = base();
    full.accounts = Array.from({ length: 20 }, (_, index) => ({ ...full.accounts[0], id: `account-${index}` }));
    expect(() => run(full, 'addAccount', { input: { name: 'Além do limite', type: 'bank', openingBalanceCents: 0 } })).toThrow('limite');
    expect(full.accounts).toHaveLength(20);
    expect(state.entries).toHaveLength(0);
  });

  it.each([1, -1])('protege o total absoluto no limite exato de centavos com saldo de sinal %s', (sign) => {
    const state = base();
    state.accounts[0].openingBalanceCents = sign * (Number.MAX_SAFE_INTEGER - 1);
    const exact = run<Entry>(state, 'saveEntry', { input: { ...entryInput(), amountCents: 1 } });
    expect(exact.result.amountCents).toBe(1);
    expect(() => run(exact.state, 'addAccount', { input: { name: 'Saldo zero', type: 'cash', openingBalanceCents: 0 } })).not.toThrow();
    expect(() => run(exact.state, 'saveEntry', { input: { ...entryInput(), amountCents: 1 } })).toThrow('limite seguro');
    expect(exact.state.entries).toHaveLength(1);
    expect(state.entries).toHaveLength(0);
  });

  it('rejeita saldo futuro ou incremento de versão inseguros', () => {
    const unsafe = { type: 'installment', description: 'Valor extremo', amountCents: Number.MAX_SAFE_INTEGER, startMonth: '2026-11', dueDay: 18, cardName: 'Cartão', installmentNumber: 1, totalInstallments: 3 };
    expect(() => run(base(), 'savePlan', { input: unsafe })).toThrow('limite');
    const first = run<Entry>(base(), 'saveEntry', { input: entryInput() });
    first.state.entries[0].version = Number.MAX_SAFE_INTEGER;
    expect(() => run(first.state, 'saveEntry', { id: first.result.id, input: entryInput(), expectedVersion: Number.MAX_SAFE_INTEGER })).toThrow('versão');
  });

  it('gera demonstração fictícia válida com recebimentos separados e relações reais', () => {
    const demo = createDemoState(now);
    expect(demo.accounts).toHaveLength(2);
    expect(demo.plans.filter((plan) => plan.type === 'salary')).toHaveLength(2);
    expect(demo.entries.some((entry) => entry.status === 'pending')).toBe(true);
    expect(demo.entries.some((entry) => entry.status === 'paid')).toBe(true);
    expect(demo.plans.some((plan) => plan.type === 'installment')).toBe(true);
    expect(demo.plans.some((plan) => plan.type === 'annual')).toBe(true);
    expect(demo.plans.some((plan) => plan.type === 'reserve')).toBe(true);
    for (const occurrence of demo.occurrences.filter((item) => item.linkedEntryId)) expect(demo.entries.find((entry) => entry.id === occurrence.linkedEntryId)?.planId).toBe(occurrence.planId);
    expect(demo.settings.exampleMode).toBe(false);
    const restored = run(demo, 'restoreBackup', { raw: { application: 'compasso-academico', version: 2, ...demo } });
    expect(restored.state).toEqual(demo);
  });
});

describe('FinanceService: previsão e situação salvas em uma única operação', () => {
  it('cadastra previsão e recebimento no mesmo comando sem criar lançamentos duplicados', () => {
    const input: PlanInput = { ...planInput(), type: 'salary', categoryId: 'income', description: 'Salário previsto', amountCents: 300000, dueDay: 5 };
    const saved = run<PlanItem>(base(), 'savePlan', { input, completion: { month: '2026-11', completed: true, paidOn: '2026-11-05' } });
    expect(saved.state.plans).toHaveLength(1);
    expect(saved.state.entries).toHaveLength(1);
    const entry = saved.state.entries[0];
    expect(entry).toMatchObject({ planId: saved.result.id, planMonth: '2026-11', kind: 'income', amountCents: 300000, status: 'paid', paidOn: '2026-11-05' });
    expect(saved.state.occurrences[0]).toMatchObject({ status: 'done', linkedEntryId: entry.id });
    expect(accountBalance(saved.state.accounts[0], saved.state.entries)).toBe(400000);
    const repeated = run<PlanItem>(saved.state, 'savePlan', { input, id: saved.result.id, expectedVersion: saved.result.version, completion: { month: '2026-11', completed: true, paidOn: '2026-11-05', expectedEntryVersion: entry.version } });
    expect(repeated.state.entries).toEqual(saved.state.entries);
  });

  it('editar apenas a previsão conserva o valor, a descrição e a data de um pagamento já registrado', () => {
    const input = planInput();
    const saved = run<PlanItem>(base(), 'savePlan', { input, completion: { month: '2026-11', completed: true, paidOn: '2026-11-10' } });
    const changed = run<PlanItem>(saved.state, 'savePlan', { id: saved.result.id, expectedVersion: saved.result.version, input: { ...input, description: 'Nova previsão', amountCents: 99999, dueDay: 28 } });
    expect(changed.result).toMatchObject({ description: 'Nova previsão', amountCents: 99999, dueDay: 28 });
    expect(changed.state.entries).toEqual(saved.state.entries);
    expect(changed.state.occurrences[0]).toMatchObject({
      status: 'done', linkedEntryId: saved.state.entries[0].id,
      snapshot: { description: 'Nova previsão', amountCents: 99999, dueOn: '2026-11-28' },
    });
    expect(rowsForMonth(changed.state.plans, changed.state.occurrences, changed.state.entries, '2026-11')[0]).toMatchObject({
      amountCents: 99999, dueOn: '2026-11-28', plan: { description: 'Nova previsão' }, linkedEntry: saved.state.entries[0],
    });
    expect(monthlyPlanningSummary(changed.state.plans, changed.state.occurrences, changed.state.entries, '2026-11').fixedCents).toBe(99999);
  });

  it('altera explicitamente a data do pagamento sem reescrever o valor real pelo novo valor previsto', () => {
    const input = planInput();
    const saved = run<PlanItem>(base(), 'savePlan', { input, completion: { month: '2026-11', completed: true, paidOn: '2026-11-10' } });
    const previous = saved.state.entries[0];
    const changed = run<PlanItem>(saved.state, 'savePlan', {
      id: saved.result.id, expectedVersion: saved.result.version,
      input: { ...input, description: 'Outra previsão', amountCents: 99999, dueDay: 28 },
      completion: { month: '2026-11', completed: true, paidOn: '2026-11-12', expectedEntryVersion: previous.version },
    });
    expect(changed.state.entries).toHaveLength(1);
    expect(changed.state.entries[0]).toMatchObject({ id: previous.id, amountCents: previous.amountCents, description: previous.description, dueOn: previous.dueOn, paidOn: '2026-11-12', status: 'paid', version: previous.version + 1 });
  });

  it('reabrir o compromisso remove a data de pagamento e atualiza o saldo sem excluir o lançamento', () => {
    const input = planInput();
    const saved = run<PlanItem>(base(), 'savePlan', { input, completion: { month: '2026-11', completed: true, paidOn: '2026-11-10' } });
    const previous = saved.state.entries[0];
    const reopened = run<PlanItem>(saved.state, 'savePlan', { input, id: saved.result.id, expectedVersion: saved.result.version, completion: { month: '2026-11', completed: false, expectedEntryVersion: previous.version } });
    expect(reopened.state.entries).toHaveLength(1);
    expect(reopened.state.entries[0]).toMatchObject({ id: previous.id, status: 'pending', amountCents: previous.amountCents, version: previous.version + 1 });
    expect(reopened.state.entries[0].paidOn).toBeUndefined();
    expect(reopened.state.occurrences[0].status).toBe('pending');
    expect(accountBalance(reopened.state.accounts[0], reopened.state.entries)).toBe(100000);
  });

  it.each(['cardFixed', 'installment', 'reserve'] as const)('conferir %s no cadastro não cria uma despesa bancária', (type) => {
    const input: PlanInput = {
      type, description: 'Compromisso sem movimento bancário', amountCents: 2500, startMonth: '2026-11', dueDay: 5,
      ...(type !== 'reserve' ? { cardName: 'Cartão de teste' } : {}),
      ...(type === 'installment' ? { installmentNumber: 4, totalInstallments: 6 } : {}),
    };
    const saved = run<PlanItem>(base(), 'savePlan', { input, completion: { month: '2026-11', completed: true } });
    expect(saved.state.entries).toHaveLength(0);
    expect(saved.state.occurrences[0]).toMatchObject({ planId: saved.result.id, month: '2026-11', status: 'done' });
    expect(accountBalance(saved.state.accounts[0], saved.state.entries)).toBe(100000);
    const undone = run<PlanItem>(saved.state, 'savePlan', { input, id: saved.result.id, expectedVersion: saved.result.version, completion: { month: '2026-11', completed: false } });
    expect(undone.state.entries).toHaveLength(0);
    expect(undone.state.occurrences[0].status).toBe('pending');
  });

  it('aceita pagamento em outro mês sem trocar a competência do planejamento', () => {
    const saved = run<PlanItem>(base(), 'savePlan', { input: { ...planInput(), startMonth: '2026-10' }, completion: { month: '2026-10', completed: true, paidOn: '2026-11-14' } });
    expect(saved.state.entries[0]).toMatchObject({ planMonth: '2026-10', occurredOn: '2026-10-20', dueOn: '2026-10-20', paidOn: '2026-11-14' });
    expect(saved.state.occurrences[0]).toMatchObject({ month: '2026-10', status: 'done' });
  });

  it.each([
    { month: '2026-11', completed: true, paidOn: '2026-11-15' },
    { month: '2026-11', completed: true, paidOn: '2026-02-30' },
    { month: '2026-13', completed: true, paidOn: '2026-11-10' },
    { month: '2026-11', completed: 'sim', paidOn: '2026-11-10' },
  ])('uma confirmação inválida desfaz também a criação da previsão: %j', (completion) => {
    const state = base();
    const original = structuredClone(state);
    expect(() => run(state, 'savePlan', { input: planInput(), completion })).toThrow(AppError);
    expect(state).toEqual(original);
    expect(state.plans).toHaveLength(0);
    expect(state.entries).toHaveLength(0);
  });

  it('rejeita versão antiga ou omitida do lançamento sem publicar a edição da previsão', () => {
    const input = planInput();
    const saved = run<PlanItem>(base(), 'savePlan', { input, completion: { month: '2026-11', completed: true, paidOn: '2026-11-10' } });
    const original = structuredClone(saved.state);
    const entry = saved.state.entries[0];
    for (const expectedEntryVersion of [undefined, entry.version - 1]) {
      try {
        run(saved.state, 'savePlan', { input: { ...input, description: 'Edição rejeitada' }, id: saved.result.id, expectedVersion: saved.result.version, completion: { month: '2026-11', completed: false, ...(expectedEntryVersion === undefined ? {} : { expectedEntryVersion }) } });
        throw new Error('Conflito esperado');
      } catch (error) { expect(error).toMatchObject({ status: 409 }); }
      expect(saved.state).toEqual(original);
    }
  });

  it('não recria silenciosamente um lançamento removido enquanto o formulário estava aberto', () => {
    const input = planInput();
    const saved = run<PlanItem>(base(), 'savePlan', { input, completion: { month: '2026-11', completed: true, paidOn: '2026-11-10' } });
    const entry = saved.state.entries[0];
    const deleted = run(saved.state, 'deleteEntry', { id: entry.id, expectedVersion: entry.version });
    const original = structuredClone(deleted.state);
    expect(() => run(deleted.state, 'savePlan', { input, id: saved.result.id, expectedVersion: saved.result.version, completion: { month: '2026-11', completed: true, paidOn: '2026-11-12', expectedEntryVersion: entry.version } })).toThrow(AppError);
    expect(deleted.state).toEqual(original);
    expect(deleted.state.entries).toHaveLength(0);
  });
});

describe('FinanceService: edição da previsão por competência', () => {
  it.each(['pending', 'paid'] as const)('atualiza lista e totais sem reescrever um lançamento %s', (status) => {
    const input: PlanInput = { ...planInput(), type: 'salary', categoryId: 'income', description: 'Salário fictício', amountCents: 510000, dueDay: 5 };
    const saved = run<PlanItem>(base(), 'savePlan', { input });
    const realized = run<Entry>(saved.state, 'realizePlan', { planId: saved.result.id, month: '2026-11' });
    const recorded = status === 'paid'
      ? run<Entry>(realized.state, 'settlePlan', { planId: saved.result.id, month: '2026-11', options: { paidOn: '2026-11-05' } })
      : realized;
    const beforeBalance = accountBalance(recorded.state.accounts[0], recorded.state.entries);
    const changed = run<PlanItem>(recorded.state, 'savePlan', {
      id: saved.result.id, expectedVersion: saved.result.version, referenceMonth: '2026-11',
      input: { ...input, description: 'Receita extra de teste', amountCents: 20000, dueDay: 30 },
    });
    expect(changed.state.entries).toEqual(recorded.state.entries);
    expect(accountBalance(changed.state.accounts[0], changed.state.entries)).toBe(beforeBalance);
    expect(rowsForMonth(changed.state.plans, changed.state.occurrences, changed.state.entries, '2026-11')[0]).toMatchObject({
      plan: { description: 'Receita extra de teste' }, amountCents: 20000, dueOn: '2026-11-30',
      linkedEntry: { id: recorded.result.id, description: 'Salário fictício', amountCents: 510000, dueOn: '2026-11-05', status },
    });
    expect(monthlyPlanningSummary(changed.state.plans, changed.state.occurrences, changed.state.entries, '2026-11').expectedIncomeCents).toBe(20000);
  });

  it('atualiza snapshots do mês consultado em diante e mantém competências anteriores', () => {
    const input = { ...planInput(), startMonth: '2026-10' };
    const saved = run<PlanItem>(base(), 'savePlan', { input });
    let state = saved.state;
    for (const selectedMonth of ['2026-10', '2026-11', '2026-12']) {
      state = run<Entry>(state, 'realizePlan', { planId: saved.result.id, month: selectedMonth }).state;
    }
    const previous = structuredClone(state);
    const changed = run<PlanItem>(state, 'savePlan', {
      id: saved.result.id, expectedVersion: saved.result.version, referenceMonth: '2026-11',
      input: { ...input, description: 'Previsão revista', amountCents: 22000, dueDay: 30 },
    });
    expect(changed.state.entries).toEqual(previous.entries);
    expect(changed.state.occurrences.find((item) => item.month === '2026-10')).toEqual(previous.occurrences.find((item) => item.month === '2026-10'));
    expect(rowsForMonth(changed.state.plans, changed.state.occurrences, changed.state.entries, '2026-10')[0]).toMatchObject({
      plan: { description: 'Conta prevista' }, amountCents: 12345, dueOn: '2026-10-20',
    });
    for (const selectedMonth of ['2026-11', '2026-12', '2027-01']) {
      expect(rowsForMonth(changed.state.plans, changed.state.occurrences, changed.state.entries, selectedMonth)[0]).toMatchObject({
        plan: { description: 'Previsão revista' }, amountCents: 22000, dueOn: `${selectedMonth}-30`,
      });
    }
  });

  it('o mês de referência omitido usa o mês do servidor', () => {
    const input = { ...planInput(), startMonth: '2026-10' };
    const saved = run<PlanItem>(base(), 'savePlan', { input });
    const october = run<Entry>(saved.state, 'realizePlan', { planId: saved.result.id, month: '2026-10' });
    const november = run<Entry>(october.state, 'realizePlan', { planId: saved.result.id, month: '2026-11' });
    const changed = run<PlanItem>(november.state, 'savePlan', { id: saved.result.id, expectedVersion: saved.result.version, input: { ...input, amountCents: 20000 } });
    expect(changed.state.occurrences.find((item) => item.month === '2026-10')?.snapshot?.amountCents).toBe(12345);
    expect(changed.state.occurrences.find((item) => item.month === '2026-11')?.snapshot?.amountCents).toBe(20000);
  });

  it.each(['cardFixed', 'reserve', 'installment'] as const)('editar %s conferido atualiza a previsão sem alterar caixa ou competências passadas', (type) => {
    const input: PlanInput = {
      type, description: 'Compromisso original', amountCents: 10000, startMonth: '2026-10', dueDay: 20,
      ...(type !== 'reserve' ? { cardName: 'Cartão original' } : {}),
      ...(type === 'installment' ? { installmentNumber: 3, totalInstallments: 6 } : {}),
    };
    const saved = run<PlanItem>(base(), 'savePlan', { input });
    const october = run<PlanOccurrence>(saved.state, 'setPlanningChecked', { planId: saved.result.id, month: '2026-10', checked: true });
    const november = run<PlanOccurrence>(october.state, 'setPlanningChecked', { planId: saved.result.id, month: '2026-11', checked: true });
    const changed = run<PlanItem>(november.state, 'savePlan', {
      id: saved.result.id, expectedVersion: saved.result.version, referenceMonth: '2026-11',
      input: { ...input, description: 'Compromisso revisto', amountCents: 20000, dueDay: 31,
        ...(type !== 'reserve' ? { cardName: 'Cartão atualizado' } : {}),
        ...(type === 'installment' ? { totalInstallments: 8 } : {}),
      },
    });
    expect(changed.state.entries).toHaveLength(0);
    expect(accountBalance(changed.state.accounts[0], changed.state.entries)).toBe(100000);
    expect(changed.state.occurrences.find((item) => item.month === '2026-10')).toEqual(october.result);
    const row = rowsForMonth(changed.state.plans, changed.state.occurrences, [], '2026-11')[0];
    expect(row).toMatchObject({ plan: { description: 'Compromisso revisto' }, amountCents: 20000, dueOn: '2026-11-30', occurrence: { status: 'done' } });
    if (type !== 'reserve') expect(row.plan.cardName).toBe('Cartão atualizado');
    if (type === 'installment') expect(row).toMatchObject({ installmentNumber: 4, remainingAfterThisMonth: 4, futureBalanceCents: 80000, lastDueOn: '2027-03-31' });
    const summary = monthlyPlanningSummary(changed.state.plans, changed.state.occurrences, [], '2026-11');
    expect(summary.committedCents).toBe(20000);
  });

  it('mudar o início mantém a referência já registrada fora da atividade da nova regra', () => {
    const input = planInput();
    const saved = run<PlanItem>(base(), 'savePlan', { input, completion: { month: '2026-11', completed: true, paidOn: '2026-11-10' } });
    const changed = run<PlanItem>(saved.state, 'savePlan', {
      id: saved.result.id, expectedVersion: saved.result.version, referenceMonth: '2026-11',
      input: { ...input, startMonth: '2026-12', amountCents: 20000 },
    });
    expect(changed.state.occurrences).toEqual(saved.state.occurrences);
    expect(changed.state.entries).toEqual(saved.state.entries);
    expect(rowsForMonth(changed.state.plans, changed.state.occurrences, changed.state.entries, '2026-11')[0].amountCents).toBe(12345);
    expect(rowsForMonth(changed.state.plans, changed.state.occurrences, changed.state.entries, '2026-12')[0].amountCents).toBe(20000);
  });

  it('vincular e editar um lançamento mantém a previsão e expõe os dados reais atuais', () => {
    const saved = run<PlanItem>(base(), 'savePlan', { input: planInput() });
    const manual = run<Entry>(saved.state, 'saveEntry', { input: { ...entryInput(), description: 'Conta real', amountCents: 15000, dueOn: '2026-11-25' } });
    const linked = run<Entry>(manual.state, 'linkPlanEntry', { planId: saved.result.id, month: '2026-11', entryId: manual.result.id });
    expect(linked.state.occurrences[0].snapshot).toMatchObject({ description: 'Conta prevista', amountCents: 12345, dueOn: '2026-11-20' });
    const edited = run<Entry>(linked.state, 'saveEntry', {
      id: linked.result.id, expectedVersion: linked.result.version,
      input: { ...linked.result, description: 'Nome real corrigido', amountCents: 18000, dueOn: '2026-11-26', status: 'paid', paidOn: '2026-11-14' },
    });
    expect(rowsForMonth(edited.state.plans, edited.state.occurrences, edited.state.entries, '2026-11')[0]).toMatchObject({
      plan: { description: 'Conta prevista' }, amountCents: 12345, dueOn: '2026-11-20',
      linkedEntry: { description: 'Nome real corrigido', amountCents: 18000, dueOn: '2026-11-26', status: 'paid', paidOn: '2026-11-14' },
    });
    expect(monthlyPlanningSummary(edited.state.plans, edited.state.occurrences, edited.state.entries, '2026-11')).toMatchObject({ fixedCents: 12345, variableCents: 0 });
    expect(accountBalance(edited.state.accounts[0], edited.state.entries)).toBe(82000);
  });

  it('uma competência inválida rejeita toda a alteração sem mudar o estado original', () => {
    const saved = run<PlanItem>(base(), 'savePlan', { input: planInput() });
    const before = structuredClone(saved.state);
    expect(() => run(saved.state, 'savePlan', { id: saved.result.id, expectedVersion: saved.result.version, referenceMonth: '2026-13', input: { ...planInput(), amountCents: 20000 } })).toThrow('mês válido');
    expect(saved.state).toEqual(before);
  });
});

describe('FinanceService: confirmação dos valores realizados', () => {
  const incomePlan = (): PlanInput => ({ ...planInput(), type: 'salary', categoryId: 'income', description: 'Receita prevista', amountCents: 510000, dueDay: 5 });
  const withSecondAccount = (): AcademicState => {
    const state = base();
    state.accounts.push({ id: 'other-account', name: 'Outra conta', type: 'bank', openingBalanceCents: 3000, createdAt: now.toISOString() });
    return state;
  };

  it('cria recebimento pelo valor e pela conta confirmados, separados da previsão', () => {
    const saved = run<PlanItem>(withSecondAccount(), 'savePlan', {
      input: incomePlan(), completion: { month: '2026-11', completed: true, paidOn: '2026-11-05', amountCents: 20000, accountId: 'other-account' },
    });
    expect(saved.state.entries).toHaveLength(1);
    expect(saved.state.entries[0]).toMatchObject({ planId: saved.result.id, kind: 'income', amountCents: 20000, accountId: 'other-account', status: 'paid' });
    expect(accountBalance(saved.state.accounts[0], saved.state.entries)).toBe(100000);
    expect(accountBalance(saved.state.accounts[1], saved.state.entries)).toBe(23000);
    expect(monthSummary(saved.state.accounts, saved.state.entries, '2026-11')).toMatchObject({ balanceCents: 123000, paidIncomeCents: 20000 });
    expect(monthlyPlanningSummary(saved.state.plans, saved.state.occurrences, saved.state.entries, '2026-11').expectedIncomeCents).toBe(510000);
  });

  it.each(['pending', 'paid'] as const)('atualiza recebimento %s pelo valor confirmado no mesmo lançamento e recalcula o saldo', (status) => {
    const input = incomePlan();
    const saved = run<PlanItem>(base(), 'savePlan', { input });
    const issued = run<Entry>(saved.state, 'realizePlan', { planId: saved.result.id, month: '2026-11' });
    const original = status === 'paid' ? run<Entry>(issued.state, 'settlePlan', { planId: saved.result.id, month: '2026-11', options: { paidOn: '2026-11-05' } }) : issued;
    const previous = original.result;
    const changed = run<PlanItem>(original.state, 'savePlan', {
      input: { ...input, amountCents: 21000 }, id: saved.result.id, expectedVersion: saved.result.version,
      completion: { month: '2026-11', completed: true, paidOn: '2026-11-06', amountCents: 20000, accountId: 'account', expectedEntryVersion: previous.version },
    });
    expect(changed.state.entries).toHaveLength(1);
    const entry = changed.state.entries[0];
    expect(entry).toMatchObject({ id: previous.id, status: 'paid', amountCents: 20000, accountId: 'account', paidOn: '2026-11-06', version: previous.version + 1, description: previous.description, dueOn: previous.dueOn, occurredOn: previous.occurredOn });
    expect(accountBalance(changed.state.accounts[0], changed.state.entries)).toBe(120000);
    expect(monthSummary(changed.state.accounts, changed.state.entries, '2026-11')).toMatchObject({ balanceCents: 120000, paidIncomeCents: 20000 });
    const repeated = run<PlanItem>(changed.state, 'savePlan', {
      input: { ...input, amountCents: 21000 }, id: saved.result.id, expectedVersion: changed.result.version,
      completion: { month: '2026-11', completed: true, paidOn: '2026-11-06', amountCents: 20000, accountId: 'account', expectedEntryVersion: entry.version },
    });
    expect(repeated.state.entries).toEqual(changed.state.entries);
    expect(monthlyPlanningSummary(changed.state.plans, changed.state.occurrences, changed.state.entries, '2026-11').expectedIncomeCents).toBe(21000);
  });

  it('corrigir a conta retira o valor da conta antiga e aplica na nova sem duplicar receita', () => {
    const input = incomePlan();
    const saved = run<PlanItem>(withSecondAccount(), 'savePlan', { input, completion: { month: '2026-11', completed: true, paidOn: '2026-11-05', amountCents: 20000, accountId: 'account' } });
    const previous = saved.state.entries[0];
    const moved = run<PlanItem>(saved.state, 'savePlan', {
      input, id: saved.result.id, expectedVersion: saved.result.version,
      completion: { month: '2026-11', completed: true, paidOn: previous.paidOn, amountCents: previous.amountCents, accountId: 'other-account', expectedEntryVersion: previous.version },
    });
    expect(moved.state.entries).toHaveLength(1);
    expect(moved.state.entries[0]).toMatchObject({ id: previous.id, amountCents: 20000, accountId: 'other-account' });
    expect(accountBalance(moved.state.accounts[0], moved.state.entries)).toBe(100000);
    expect(accountBalance(moved.state.accounts[1], moved.state.entries)).toBe(23000);
    expect(monthSummary(moved.state.accounts, moved.state.entries, '2026-11').balanceCents).toBe(monthSummary(saved.state.accounts, saved.state.entries, '2026-11').balanceCents);
    const reopened = run<PlanItem>(moved.state, 'savePlan', { input, id: saved.result.id, expectedVersion: moved.result.version, completion: { month: '2026-11', completed: false, expectedEntryVersion: moved.state.entries[0].version } });
    expect(accountBalance(reopened.state.accounts[0], reopened.state.entries)).toBe(100000);
    expect(accountBalance(reopened.state.accounts[1], reopened.state.entries)).toBe(3000);
    expect(reopened.state.entries[0]).toMatchObject({ id: previous.id, status: 'pending', amountCents: 20000, accountId: 'other-account' });
    expect(reopened.state.entries[0].paidOn).toBeUndefined();
  });

  it('confirma o valor real de uma despesa e reduz o saldo por esse valor', () => {
    const input = planInput();
    const saved = run<PlanItem>(base(), 'savePlan', { input });
    const pending = run<Entry>(saved.state, 'realizePlan', { planId: saved.result.id, month: '2026-11' });
    const paid = run<Entry>(pending.state, 'settlePlan', { planId: saved.result.id, month: '2026-11', options: { paidOn: '2026-11-10', amountCents: 15000, accountId: 'account', expectedEntryVersion: pending.result.version } });
    expect(paid.result).toMatchObject({ id: pending.result.id, amountCents: 15000, status: 'paid' });
    expect(accountBalance(paid.state.accounts[0], paid.state.entries)).toBe(85000);
    expect(monthSummary(paid.state.accounts, paid.state.entries, '2026-11')).toMatchObject({ balanceCents: 85000, paidExpenseCents: 15000 });
    expect(monthlyPlanningSummary(paid.state.plans, paid.state.occurrences, paid.state.entries, '2026-11').fixedCents).toBe(12345);
  });

  it.each([
    { amountCents: 0 }, { amountCents: -1 }, { amountCents: 1.5 }, { amountCents: null },
    { accountId: 'missing' }, { accountId: '' }, { accountId: null },
  ])('uma confirmação financeira inválida rejeita também a previsão: %j', (invalid) => {
    const original = withSecondAccount();
    const previous = structuredClone(original);
    expect(() => run(original, 'savePlan', { input: incomePlan(), completion: { month: '2026-11', completed: true, paidOn: '2026-11-05', ...invalid } })).toThrow(AppError);
    expect(original).toEqual(previous);
  });

  it.each([{ amountCents: 20000 }, { accountId: 'account' }])('rejeita dados financeiros em confirmação pendente: %j', (fields) => {
    expect(() => run(base(), 'savePlan', { input: incomePlan(), completion: { month: '2026-11', completed: false, ...fields } })).toThrow('pendente');
  });

  it.each(['cardFixed', 'installment', 'reserve'] as const)('rejeita valor ou conta realizados ao conferir %s', (type) => {
    const input: PlanInput = { type, description: 'Sem movimento bancário', amountCents: 10000, startMonth: '2026-11', dueDay: 10, ...(type !== 'reserve' ? { cardName: 'Cartão' } : {}), ...(type === 'installment' ? { installmentNumber: 1, totalInstallments: 2 } : {}) };
    for (const fields of [{ amountCents: 20000 }, { accountId: 'account' }]) {
      expect(() => run(base(), 'savePlan', { input, completion: { month: '2026-11', completed: true, ...fields } })).toThrow('sem registrar pagamento bancário');
    }
  });

  it('correção explícita por settlePlan atualiza pago e conta sem alterar a data omitida nem duplicar', () => {
    const saved = run<PlanItem>(withSecondAccount(), 'savePlan', { input: incomePlan(), completion: { month: '2026-11', completed: true, paidOn: '2026-11-05' } });
    const previous = saved.state.entries[0];
    const corrected = run<Entry>(saved.state, 'settlePlan', { planId: saved.result.id, month: '2026-11', options: { amountCents: 20000, accountId: 'other-account', expectedEntryVersion: previous.version } });
    expect(corrected.result).toMatchObject({ id: previous.id, paidOn: '2026-11-05', amountCents: 20000, accountId: 'other-account', status: 'paid', version: previous.version + 1 });
    expect(corrected.state.entries).toHaveLength(1);
    expect(accountBalance(corrected.state.accounts[0], corrected.state.entries)).toBe(100000);
    expect(accountBalance(corrected.state.accounts[1], corrected.state.entries)).toBe(23000);
    const repeated = run<Entry>(corrected.state, 'settlePlan', { planId: saved.result.id, month: '2026-11', options: { amountCents: 20000, accountId: 'other-account', expectedEntryVersion: corrected.result.version } });
    expect(repeated.state.entries).toEqual(corrected.state.entries);
  });

  it('settlePlan novo aceita valor e conta explícitos sem exigir versão inexistente', () => {
    const saved = run<PlanItem>(withSecondAccount(), 'savePlan', { input: incomePlan() });
    const received = run<Entry>(saved.state, 'settlePlan', { planId: saved.result.id, month: '2026-11', options: { amountCents: 20000, accountId: 'other-account', paidOn: '2026-11-06' } });
    expect(received.state.entries).toHaveLength(1);
    expect(received.result).toMatchObject({ amountCents: 20000, accountId: 'other-account', status: 'paid', paidOn: '2026-11-06' });
  });

  it.each(['amount', 'account'] as const)('settlePlan exige versão atual com %s explícito, mesmo sem mudança do valor', (field) => {
    const saved = run<PlanItem>(base(), 'savePlan', { input: incomePlan(), completion: { month: '2026-11', completed: true, paidOn: '2026-11-05' } });
    const previous = saved.state.entries[0];
    const fields = field === 'amount' ? { amountCents: previous.amountCents } : { accountId: previous.accountId };
    for (const expectedEntryVersion of [undefined, previous.version - 1]) {
      expect(() => run(saved.state, 'settlePlan', { planId: saved.result.id, month: '2026-11', options: { ...fields, ...(expectedEntryVersion === undefined ? {} : { expectedEntryVersion }) } })).toThrow('alterado');
      expect(saved.state.entries[0]).toEqual(previous);
    }
  });

  it('settlePlan não recria o lançamento removido quando a confirmação informa sua versão', () => {
    const saved = run<PlanItem>(base(), 'savePlan', { input: incomePlan(), completion: { month: '2026-11', completed: true, paidOn: '2026-11-05' } });
    const previous = saved.state.entries[0];
    const deleted = run(saved.state, 'deleteEntry', { id: previous.id, expectedVersion: previous.version });
    expect(() => run(deleted.state, 'settlePlan', { planId: saved.result.id, month: '2026-11', options: { amountCents: 20000, accountId: 'account', expectedEntryVersion: previous.version } })).toThrow('alterado');
    expect(deleted.state.entries).toHaveLength(0);
  });

  it('savePlan não publica edição financeira com versão antiga ou ausente', () => {
    const input = incomePlan();
    const saved = run<PlanItem>(base(), 'savePlan', { input, completion: { month: '2026-11', completed: true, paidOn: '2026-11-05' } });
    const before = structuredClone(saved.state);
    for (const expectedEntryVersion of [undefined, saved.state.entries[0].version - 1]) {
      expect(() => run(saved.state, 'savePlan', { input: { ...input, amountCents: 20000 }, id: saved.result.id, expectedVersion: saved.result.version, completion: { month: '2026-11', completed: true, paidOn: '2026-11-05', amountCents: 20000, accountId: 'account', ...(expectedEntryVersion === undefined ? {} : { expectedEntryVersion }) } })).toThrow('alterado');
      expect(saved.state).toEqual(before);
    }
  });
});
