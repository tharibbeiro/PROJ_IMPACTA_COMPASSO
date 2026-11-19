import { describe, expect, it } from 'vitest';
import { monthSummary } from './finance';
import type { Entry } from './types';
import type { PlanInput, PlanItem, PlanOccurrence } from './planning-types';
import { addMonths, dueDateForMonth, isValidMonth, monthlyPlanningSummary, occurrencesForMonth, rowsForMonth, snapshotForRow, validatePlanInput } from './planning';

const baseInput: PlanInput = {
  type: 'fixed', description: 'Conta mensal', amountCents: 10000, startMonth: '2026-11', dueDay: 10,
  accountId: 'account', categoryId: 'expense',
};

function plan(overrides: Partial<PlanItem> = {}): PlanItem {
  return { ...baseInput, id: 'plan', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', version: 1, ...overrides };
}

function entry(overrides: Partial<Entry & { planId?: string; planMonth?: string; isCardPayment?: boolean }> = {}): Entry {
  return {
    id: 'entry', description: 'Lançamento', kind: 'expense', amountCents: 2000, accountId: 'account', categoryId: 'expense',
    occurredOn: '2026-11-10', dueOn: '2026-11-10', status: 'pending', version: 1,
    createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', ...overrides,
  };
}

describe('calendário de planejamento', () => {
  it('soma meses sem depender do fuso horário e valida o calendário', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(isValidMonth('2026-13')).toBe(false);
    expect(() => addMonths('2026-02', 0.5)).toThrow();
    expect(dueDateForMonth('2028-02', 31)).toBe('2028-02-29');
    expect(dueDateForMonth('2027-02', 31)).toBe('2027-02-28');
    expect(dueDateForMonth('2026-04', 31)).toBe('2026-04-30');
  });

  it('mantém salário e adiantamento como duas receitas previstas', () => {
    const plans = [
      plan({ id: 'salary', type: 'salary', description: 'Salário', amountCents: 30000, dueDay: 5 }),
      plan({ id: 'advance', type: 'salary', description: 'Adiantamento', amountCents: 10000, dueDay: 20 }),
    ];
    const rows = occurrencesForMonth(plans, '2026-11');
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.dueOn)).toEqual(['2026-11-05', '2026-11-20']);
    expect(monthlyPlanningSummary(plans, [], [], '2026-11').expectedIncomeCents).toBe(40000);
  });

  it('interpreta n/N como a parcela atual e encerra a previsão na última', () => {
    const item = plan({ type: 'installment', cardName: 'Cartão', amountCents: 2345, installmentNumber: 3, totalInstallments: 5, dueDay: 31 });
    expect(occurrencesForMonth([item], '2026-10')).toHaveLength(0);
    expect(occurrencesForMonth([item], '2026-11')[0]).toMatchObject({ installmentNumber: 3, remainingAfterThisMonth: 2, futureBalanceCents: 4690, lastDueOn: '2027-01-31', dueOn: '2026-11-30' });
    expect(occurrencesForMonth([item], '2026-12')[0].installmentNumber).toBe(4);
    expect(occurrencesForMonth([item], '2027-01')[0]).toMatchObject({ installmentNumber: 5, remainingAfterThisMonth: 0, futureBalanceCents: 0 });
    expect(occurrencesForMonth([item], '2027-02')).toHaveLength(0);
  });

  it('conta anual aparece somente no mês de vencimento e respeita fevereiro', () => {
    const item = plan({ type: 'annual', startMonth: '2024-02', dueDay: 31 });
    expect(occurrencesForMonth([item], '2023-02')).toHaveLength(0);
    expect(occurrencesForMonth([item], '2024-03')).toHaveLength(0);
    expect(occurrencesForMonth([item], '2024-02')[0].dueOn).toBe('2024-02-29');
    expect(occurrencesForMonth([item], '2025-02')[0].dueOn).toBe('2025-02-28');
  });

  it('arquivar a partir de um mês preserva as previsões anteriores', () => {
    const item = plan({ startMonth: '2026-09', archived: true, archivedFromMonth: '2026-11' });
    expect(occurrencesForMonth([item], '2026-10')).toHaveLength(1);
    expect(occurrencesForMonth([item], '2026-11')).toHaveLength(0);
    expect(occurrencesForMonth([item], '2026-12')).toHaveLength(0);
    expect(occurrencesForMonth([plan({ endMonth: '2026-11' })], '2026-12')).toHaveLength(0);
  });
});

describe('conciliação entre previsão e lançamento', () => {
  it('mantém o valor previsto e não duplica gastos fixos vinculados como variáveis', () => {
    const plans = [plan(), plan({ id: 'reserve', type: 'reserve', amountCents: 4000 })];
    const entries = [entry({ planId: 'plan', planMonth: '2026-11', amountCents: 12500 }), entry({ id: 'variable', amountCents: 3000 })];
    const summary = monthlyPlanningSummary(plans, [], entries, '2026-11');
    expect(summary.fixedCents).toBe(10000);
    expect(summary.variableCents).toBe(3000);
    expect(summary.reserveCents).toBe(4000);
    expect(summary.committedCents).toBe(17000);
    expect(summary.availableCents).toBe(-17000);
  });

  it('mantém o valor financeiro registrado mesmo após arquivar ou mudar o início do plano', () => {
    const item = plan({ startMonth: '2027-01', archived: true, archivedFromMonth: '2026-11', amountCents: 15000 });
    const paid = entry({ planId: 'plan', planMonth: '2026-11', amountCents: 9000, status: 'paid', paidOn: '2026-11-10' });
    expect(occurrencesForMonth([item], '2026-11')).toHaveLength(0);
    const rows = rowsForMonth([item], [], [paid], '2026-11');
    expect(rows).toHaveLength(1);
    expect(rows[0].amountCents).toBe(9000);
    expect(rows[0].linkedEntry?.id).toBe('entry');
    expect(monthlyPlanningSummary([item], [], [paid], '2026-11').fixedCents).toBe(9000);
  });

  it('não transforma em variável um lançamento vinculado à competência de outro mês', () => {
    const paid = entry({ planId: 'plan', planMonth: '2026-10', occurredOn: '2026-11-01' });
    expect(monthlyPlanningSummary([plan({ startMonth: '2026-10' })], [], [paid], '2026-11').variableCents).toBe(0);
    expect(monthlyPlanningSummary([plan({ startMonth: '2026-10' })], [], [paid], '2026-10').fixedCents).toBe(10000);
  });

  it('não soma receitas manuais ao salário previsto sem uma vinculação explícita', () => {
    const plans = [plan({ type: 'salary', amountCents: 30000 })];
    const entries = [
      entry({ id: 'received', kind: 'income', amountCents: 5000, status: 'paid', paidOn: '2026-11-10' }),
      entry({ id: 'pending', kind: 'income', amountCents: 8000 }),
      entry({ id: 'salary-real', kind: 'income', planId: 'plan', planMonth: '2026-11', amountCents: 28000, status: 'paid', paidOn: '2026-11-10' }),
    ];
    expect(monthlyPlanningSummary(plans, [], entries, '2026-11').expectedIncomeCents).toBe(30000);
    expect(monthlyPlanningSummary(plans, [], [entry({ kind: 'income', amountCents: 30000, status: 'paid', paidOn: '2026-11-10' })], '2026-11').expectedIncomeCents).toBe(30000);
  });

  it('preserva compromissos após conferência/pagamento e reserva separada de consumo', () => {
    const plans = [plan(), plan({ id: 'card', type: 'cardFixed', cardName: 'Cartão', amountCents: 2000 }), plan({ id: 'reserve', type: 'reserve', amountCents: 3000 })];
    const occurrences: PlanOccurrence[] = plans.map((item) => ({ id: `${item.id}:2026-11`, planId: item.id, month: '2026-11', status: 'done', updatedAt: '2026-11-10T00:00:00.000Z' }));
    const summary = monthlyPlanningSummary(plans, occurrences, [], '2026-11');
    expect(summary.fixedCents).toBe(10000);
    expect(summary.cardFixedCents).toBe(2000);
    expect(summary.reserveCents).toBe(3000);
    expect(summary.committedCents).toBe(15000);
  });

  it('referências órfãs não escondem despesas reais', () => {
    expect(monthlyPlanningSummary([], [], [entry({ planId: 'missing', planMonth: '2026-11' })], '2026-11').variableCents).toBe(2000);
  });

  it('quitação de fatura já prevista não duplica o orçamento e continua saindo do caixa', () => {
    const plans = [
      plan({ id: 'subscription', type: 'cardFixed', cardName: 'Cartão', amountCents: 2500 }),
      plan({ id: 'purchase', type: 'installment', cardName: 'Cartão', amountCents: 5000, installmentNumber: 1, totalInstallments: 2 }),
    ];
    const entries = [
      entry({ id: 'invoice', description: 'Quitação da fatura prevista', amountCents: 7500, isCardPayment: true, status: 'paid', paidOn: '2026-11-10' }),
      entry({ id: 'groceries', description: 'Despesa variável comum', amountCents: 1234, status: 'paid', paidOn: '2026-11-10' }),
    ];
    const summary = monthlyPlanningSummary(plans, [], entries, '2026-11');
    expect(summary.cardFixedCents).toBe(2500);
    expect(summary.installmentCents).toBe(5000);
    expect(summary.variableCents).toBe(1234);
    expect(summary.committedCents).toBe(8734);
    expect(monthSummary([], entries, '2026-11').paidExpenseCents).toBe(8734);
  });

  it('congela cartão e reserva conferidos mesmo após edição e arquivamento do plano', () => {
    const originalCard = plan({ id: 'card', type: 'installment', description: 'Compra original', cardName: 'Cartão original', amountCents: 1234, installmentNumber: 2, totalInstallments: 4, dueDay: 30 });
    const originalReserve = plan({ id: 'reserve', type: 'reserve', description: 'Reserva original', amountCents: 2345, dueDay: 5 });
    const occurrences: PlanOccurrence[] = occurrencesForMonth([originalCard, originalReserve], '2026-11').map((row) => ({
      id: `${row.plan.id}:2026-11`, planId: row.plan.id, month: '2026-11', status: 'done', updatedAt: '2026-11-10T00:00:00.000Z', snapshot: snapshotForRow(row),
    }));
    const changedPlans = [
      { ...originalCard, description: 'Compra editada', amountCents: 9999, cardName: 'Outro cartão', dueDay: 1, totalInstallments: 10, archived: true, archivedFromMonth: '2026-11' },
      { ...originalReserve, description: 'Reserva editada', amountCents: 8888, startMonth: '2027-01' },
    ];
    const rows = rowsForMonth(changedPlans, occurrences, [], '2026-11');
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.plan.id === 'card')).toMatchObject({
      amountCents: 1234, dueOn: '2026-11-30', installmentNumber: 2, remainingAfterThisMonth: 2, futureBalanceCents: 2468, lastDueOn: '2027-01-30',
      plan: { description: 'Compra original', cardName: 'Cartão original', totalInstallments: 4 },
    });
    expect(rows.find((row) => row.plan.id === 'reserve')).toMatchObject({ amountCents: 2345, dueOn: '2026-11-05', plan: { description: 'Reserva original' } });
    expect(monthlyPlanningSummary(changedPlans, occurrences, [], '2026-11')).toMatchObject({ installmentCents: 1234, reserveCents: 2345 });
  });

  it('snapshot mantém a previsão enquanto o vínculo expõe o lançamento real atualizado', () => {
    const item = plan({ description: 'Descrição da época', amountCents: 10000 });
    const occurrence: PlanOccurrence = { id: 'plan:2026-11', planId: 'plan', month: '2026-11', status: 'pending', linkedEntryId: 'entry', updatedAt: '2026-11-10T00:00:00.000Z', snapshot: snapshotForRow(occurrencesForMonth([item], '2026-11')[0]) };
    const actual = entry({ planId: 'plan', planMonth: '2026-11', description: 'Conta corrigida em lançamentos', amountCents: 11500, dueOn: '2026-11-12', status: 'paid', paidOn: '2026-11-13' });
    const row = rowsForMonth([{ ...item, description: 'Descrição nova', amountCents: 20000 }], [occurrence], [actual], '2026-11')[0];
    expect(row).toMatchObject({ amountCents: 10000, dueOn: '2026-11-10', plan: { description: 'Descrição da época' }, linkedEntry: actual });
    expect(monthlyPlanningSummary([item], [occurrence], [actual], '2026-11').fixedCents).toBe(10000);
  });

  it('sem snapshot a previsão ativa ainda prevalece sobre o lançamento real vinculado', () => {
    const item = plan({ description: 'Previsão atual', amountCents: 15000, dueDay: 25 });
    const actual = entry({ planId: item.id, planMonth: '2026-11', description: 'Registro anterior', amountCents: 12000, dueOn: '2026-11-12' });
    expect(rowsForMonth([item], [], [actual], '2026-11')[0]).toMatchObject({
      amountCents: 15000, dueOn: '2026-11-25', plan: { description: 'Previsão atual' }, linkedEntry: actual,
    });
  });

  it('vínculo legado sem previsão nem snapshot conserva descrição e data reais', () => {
    const item = plan({ startMonth: '2027-01', description: 'Regra futura' });
    const actual = entry({ planId: item.id, planMonth: '2026-11', description: 'Registro do mês anterior', amountCents: 12000, dueOn: '2026-11-12' });
    expect(rowsForMonth([item], [], [actual], '2026-11')[0]).toMatchObject({
      amountCents: 12000, dueOn: '2026-11-12', plan: { description: 'Registro do mês anterior' }, linkedEntry: actual,
    });
  });
});

describe('validação de planos', () => {
  it('normaliza texto e descarta metadados sem função para o tipo', () => {
    expect(validatePlanInput({ ...baseInput, description: '  Internet  ', installmentNumber: 2, totalInstallments: 5 })).toEqual({ ...baseInput, description: 'Internet' });
  });

  it('exige conta/categoria para itens bancários, cartão para crédito e n/N consistente', () => {
    expect(() => validatePlanInput({ ...baseInput, accountId: undefined })).toThrow('conta');
    expect(() => validatePlanInput({ ...baseInput, type: 'cardFixed' })).toThrow('cartão');
    expect(() => validatePlanInput({ ...baseInput, type: 'installment', cardName: 'Cartão', installmentNumber: 5, totalInstallments: 4 })).toThrow('parcela');
    expect(() => validatePlanInput({ ...baseInput, endMonth: '2026-10' })).toThrow('final');
    expect(() => validatePlanInput({ ...baseInput, amountCents: 1.1 })).toThrow('centavos');
    expect(() => validatePlanInput({ ...baseInput, dueDay: 32 })).toThrow('dia');
    expect(validatePlanInput({ ...baseInput, type: 'reserve', accountId: undefined, categoryId: undefined })).toMatchObject({ type: 'reserve' });
  });
});
