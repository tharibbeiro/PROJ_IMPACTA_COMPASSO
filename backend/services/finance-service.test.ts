import { describe, expect, it } from 'vitest';
import { AppError, type AcademicState, type FinanceCommand } from '../contracts';
import { accountBalance } from '../../shared/domain/finance';
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

  it('registra e quita plano uma única vez mantendo o valor real no orçamento', () => {
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
    const changed = run<PlanItem>(checked.state, 'savePlan', { id: planned.result.id, expectedVersion: 1, input: { ...initial, description: 'Nova descrição', amountCents: 8000, dueDay: 28 } });
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
    expect(changed.state.occurrences).toEqual(saved.state.occurrences);
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
