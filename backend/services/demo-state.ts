import type { AcademicState, FinanceCommand } from '../contracts';
import { localDate } from '../../shared/domain/finance';
import { addMonths } from '../../shared/domain/planning';
import type { PlanInput, PlanItem } from '../../shared/domain/planning-types';
import { FinanceService } from './finance-service';

/** Dados inteiramente fictícios; cada visitante recebe uma cópia independente. */
export function createDemoState(now: Date = new Date()): AcademicState {
  const today = localDate(now);
  const selectedMonth = today.slice(0, 7);
  const currentDay = Number(today.slice(8));
  const timestamp = now.toISOString();
  let state: AcademicState = {
    accounts: [
      { id: 'demo-main', name: 'Conta de demonstração', type: 'bank', openingBalanceCents: 126000, createdAt: timestamp },
      { id: 'demo-wallet', name: 'Carteira fictícia', type: 'cash', openingBalanceCents: 18500, createdAt: timestamp },
    ],
    categories: [
      { id: 'expense-food', name: 'Alimentação', kind: 'expense', color: '#df9658' },
      { id: 'expense-home', name: 'Moradia', kind: 'expense', color: '#668c79' },
      { id: 'expense-transport', name: 'Transporte', kind: 'expense', color: '#7297b1' },
      { id: 'expense-health', name: 'Saúde', kind: 'expense', color: '#b186a3' },
      { id: 'expense-leisure', name: 'Lazer', kind: 'expense', color: '#bda05c' },
      { id: 'expense-subscriptions', name: 'Assinaturas', kind: 'expense', color: '#8c87af' },
      { id: 'expense-other', name: 'Outros gastos', kind: 'expense', color: '#87928e' },
      { id: 'income-salary', name: 'Salário', kind: 'income', color: '#287461' },
      { id: 'income-extra', name: 'Renda extra', kind: 'income', color: '#6a9475' },
    ],
    entries: [], plans: [], occurrences: [],
    settings: { id: 'preferences', displayName: 'Demonstração', exampleMode: false },
  };
  const service = new FinanceService(() => new Date(now));
  const run = (type: string, payload: FinanceCommand['payload']): unknown => {
    const applied = service.apply(state, { id: crypto.randomUUID(), type, payload });
    state = applied.state;
    return applied.result;
  };
  const plan = (input: PlanInput) => run('savePlan', { input }) as PlanItem;
  const main = { accountId: 'demo-main', startMonth: selectedMonth };
  const salary = plan({ ...main, type: 'salary', description: 'Salário fictício', amountCents: 510000, dueDay: 5, categoryId: 'income-salary' });
  const advance = plan({ ...main, type: 'salary', description: 'Adiantamento fictício', amountCents: 127500, dueDay: 20, categoryId: 'income-salary' });
  const rent = plan({ ...main, type: 'fixed', description: 'Aluguel de demonstração', amountCents: 142000, dueDay: 10, categoryId: 'expense-home' });
  const internet = plan({ ...main, type: 'fixed', description: 'Internet de demonstração', amountCents: 11290, dueDay: 15, categoryId: 'expense-home' });
  const energy = plan({ ...main, type: 'fixed', description: 'Energia estimada', amountCents: 18550, dueDay: 28, categoryId: 'expense-home' });
  const subscription = plan({ type: 'cardFixed', description: 'Assinatura de música', amountCents: 2190, startMonth: selectedMonth, dueDay: 18, cardName: 'Cartão fictício' });
  plan({ type: 'installment', description: 'Notebook de demonstração', amountCents: 24390, startMonth: selectedMonth, dueDay: 18, cardName: 'Cartão fictício', installmentNumber: 5, totalInstallments: 12 });
  plan({ ...main, type: 'annual', description: 'Seguro anual fictício', amountCents: 94900, startMonth: addMonths(selectedMonth, 2), dueDay: 25, categoryId: 'expense-other' });
  const reserve = plan({ type: 'reserve', description: 'Reserva para estudos', amountCents: 35000, startMonth: selectedMonth, dueDay: 25 });

  for (const item of [salary, advance, rent, internet, energy]) {
    if (item !== energy && currentDay >= item.dueDay) {
      run('settlePlan', { planId: item.id, month: selectedMonth, options: { paidOn: `${selectedMonth}-${String(item.dueDay).padStart(2, '0')}` } });
    } else {
      run('realizePlan', { planId: item.id, month: selectedMonth });
    }
  }
  run('setPlanningChecked', { planId: subscription.id, month: selectedMonth, checked: true });
  if (currentDay >= 10) run('setPlanningChecked', { planId: reserve.id, month: selectedMonth, checked: true });
  for (const item of [
    { description: 'Mercado fictício', amountCents: 28740, categoryId: 'expense-food', accountId: 'demo-main' },
    { description: 'Transporte de demonstração', amountCents: 6490, categoryId: 'expense-transport', accountId: 'demo-main' },
    { description: 'Lanche de demonstração', amountCents: 1850, categoryId: 'expense-food', accountId: 'demo-wallet' },
  ]) {
    run('saveEntry', { input: { ...item, kind: 'expense', occurredOn: today, dueOn: today, status: 'paid', paidOn: today } });
  }
  return state;
}
