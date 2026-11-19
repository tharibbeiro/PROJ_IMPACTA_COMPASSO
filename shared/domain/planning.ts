import type { Entry } from './types';
import type { MonthlyPlanningSummary, PlanInput, PlanItem, PlanOccurrence, PlanningOccurrenceSnapshot, PlanningRow, PlanType } from './planning-types';

const types: PlanType[] = ['salary', 'fixed', 'cardFixed', 'installment', 'annual', 'reserve'];

export function isValidMonth(value: unknown): value is string {
  return typeof value === 'string' && /^(19\d{2}|[2-9]\d{3})-(0[1-9]|1[0-2])$/.test(value);
}

function monthIndex(month: string): number {
  if (!isValidMonth(month)) throw new Error('Informe um mês válido no formato ano-mês.');
  const [year, number] = month.split('-').map(Number);
  return year * 12 + number - 1;
}

export function addMonths(month: string, count: number): string {
  if (!Number.isSafeInteger(count)) throw new Error('A quantidade de meses é inválida.');
  const index = monthIndex(month) + count;
  const year = Math.floor(index / 12);
  const number = index - year * 12 + 1;
  if (year < 1900 || year > 9999) throw new Error('A data calculada está fora do intervalo permitido.');
  return `${year}-${String(number).padStart(2, '0')}`;
}

/** Usa o último dia real do mês quando o vencimento configurado é 29, 30 ou 31. */
export function dueDateForMonth(month: string, dueDay: number): string {
  monthIndex(month);
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) throw new Error('O dia de vencimento deve estar entre 1 e 31.');
  const [year, number] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return `${month}-${String(Math.min(dueDay, lastDay)).padStart(2, '0')}`;
}

function text(value: unknown, label: string, maximum: number, required = true): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`Informe ${label}.`);
    return undefined;
  }
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new Error(`${label}: use um texto de até ${maximum} caracteres.`);
  }
  return value.trim();
}

/** Validação estrutural; a existência de conta e categoria é verificada no repositório. */
export function validatePlanInput(input: PlanInput): PlanInput {
  if (!input || typeof input !== 'object' || !types.includes(input.type)) throw new Error('Escolha um tipo de planejamento válido.');
  const description = text(input.description, 'a descrição', 160)!;
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new Error('O valor planejado deve ser maior que zero, em centavos inteiros.');
  if (!isValidMonth(input.startMonth)) throw new Error('Informe o mês inicial do planejamento.');
  if (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 31) throw new Error('O dia de vencimento deve estar entre 1 e 31.');
  const endMonth = text(input.endMonth, 'o mês final', 7, false);
  if (endMonth && (!isValidMonth(endMonth) || endMonth < input.startMonth)) throw new Error('O mês final deve ser igual ou posterior ao mês inicial.');
  const bankItem = input.type === 'salary' || input.type === 'fixed' || input.type === 'annual';
  const cardItem = input.type === 'cardFixed' || input.type === 'installment';
  const accountId = text(input.accountId, 'a conta', 100, bankItem);
  const categoryId = text(input.categoryId, 'a categoria', 100, bankItem);
  const cardName = text(input.cardName, 'o nome do cartão', 80, cardItem);
  let installment: Pick<PlanInput, 'installmentNumber' | 'totalInstallments'> = {};
  if (input.type === 'installment') {
    const current = input.installmentNumber;
    const total = input.totalInstallments;
    if (!Number.isInteger(current) || !Number.isInteger(total) || current! < 1 || total! < 1 || total! > 1200 || current! > total!) {
      throw new Error('Informe a parcela deste mês e o total de parcelas, entre 1 e 1.200.');
    }
    addMonths(input.startMonth, total! - current!);
    installment = { installmentNumber: current, totalInstallments: total };
  }
  return {
    type: input.type, description, amountCents: input.amountCents, startMonth: input.startMonth, dueDay: input.dueDay,
    ...(endMonth ? { endMonth } : {}), ...(accountId ? { accountId } : {}), ...(categoryId ? { categoryId } : {}),
    ...(cardName ? { cardName } : {}), ...installment,
  };
}

function safeSum(values: number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) throw new Error('A soma dos valores ultrapassa o limite permitido.');
  return total;
}

function rowForPlan(plan: PlanItem, month: string): PlanningRow {
  const row: PlanningRow = { plan, month, amountCents: plan.amountCents, dueOn: dueDateForMonth(month, plan.dueDay) };
  if (plan.type === 'installment') {
    const elapsed = monthIndex(month) - monthIndex(plan.startMonth);
    const installmentNumber = plan.installmentNumber! + elapsed;
    const remaining = Math.max(0, plan.totalInstallments! - installmentNumber);
    const lastMonth = addMonths(month, remaining);
    const futureBalanceCents = plan.amountCents * remaining;
    if (!Number.isSafeInteger(futureBalanceCents)) throw new Error('O saldo futuro das parcelas ultrapassa o limite permitido.');
    Object.assign(row, { installmentNumber, remainingAfterThisMonth: remaining, futureBalanceCents, lastDueOn: dueDateForMonth(lastMonth, plan.dueDay) });
  }
  return row;
}

export function occurrencesForMonth(plans: PlanItem[], month: string): PlanningRow[] {
  const index = monthIndex(month);
  return plans.filter((plan) => {
    const start = monthIndex(plan.startMonth);
    if (index < start || (plan.endMonth && month > plan.endMonth)) return false;
    if (plan.archived && (!plan.archivedFromMonth || month >= plan.archivedFromMonth)) return false;
    if (plan.type === 'annual' && month.slice(5) !== plan.startMonth.slice(5)) return false;
    if (plan.type === 'installment' && plan.installmentNumber! + index - start > plan.totalInstallments!) return false;
    return true;
  }).map((plan) => rowForPlan(plan, month)).sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.plan.description.localeCompare(b.plan.description, 'pt-BR'));
}

type LinkedEntry = Entry & { planId?: string; planMonth?: string };

/** Captura a previsão da competência; edições posteriores preservam os meses anteriores. */
export function snapshotForRow(row: PlanningRow): PlanningOccurrenceSnapshot {
  return {
    type: row.plan.type,
    description: row.plan.description,
    amountCents: row.amountCents,
    dueOn: row.dueOn,
    ...(row.plan.cardName ? { cardName: row.plan.cardName } : {}),
    ...(row.installmentNumber !== undefined ? { installmentNumber: row.installmentNumber } : {}),
    ...(row.plan.totalInstallments !== undefined ? { totalInstallments: row.plan.totalInstallments } : {}),
    ...(row.remainingAfterThisMonth !== undefined ? { remainingAfterThisMonth: row.remainingAfterThisMonth } : {}),
    ...(row.futureBalanceCents !== undefined ? { futureBalanceCents: row.futureBalanceCents } : {}),
    ...(row.lastDueOn ? { lastDueOn: row.lastDueOn } : {}),
  };
}

function rowFromSnapshot(plan: PlanItem, occurrence: PlanOccurrence): PlanningRow {
  const snapshot = occurrence.snapshot!;
  const { cardName: _newCardName, ...currentPlan } = plan;
  return {
    plan: {
      ...currentPlan, type: snapshot.type, description: snapshot.description, amountCents: snapshot.amountCents,
      ...(snapshot.cardName ? { cardName: snapshot.cardName } : {}),
      ...(snapshot.totalInstallments !== undefined ? { totalInstallments: snapshot.totalInstallments } : {}),
    },
    month: occurrence.month,
    amountCents: snapshot.amountCents,
    dueOn: snapshot.dueOn,
    ...(snapshot.installmentNumber !== undefined ? { installmentNumber: snapshot.installmentNumber } : {}),
    ...(snapshot.remainingAfterThisMonth !== undefined ? { remainingAfterThisMonth: snapshot.remainingAfterThisMonth } : {}),
    ...(snapshot.futureBalanceCents !== undefined ? { futureBalanceCents: snapshot.futureBalanceCents } : {}),
    ...(snapshot.lastDueOn ? { lastDueOn: snapshot.lastDueOn } : {}),
    occurrence,
  };
}

function linkedEntriesForMonth(plans: PlanItem[], occurrences: PlanOccurrence[], entries: Entry[], month: string): Map<string, Entry[]> {
  const ids = new Set(plans.map((plan) => plan.id));
  const occurrenceByEntry = new Map(occurrences.filter((occurrence) => occurrence.month === month && occurrence.linkedEntryId)
    .map((occurrence) => [occurrence.linkedEntryId!, occurrence.planId]));
  const result = new Map<string, Entry[]>();
  for (const value of entries) {
    const entry = value as LinkedEntry;
    const id = entry.planId && entry.planMonth === month ? entry.planId : occurrenceByEntry.get(entry.id);
    if (!id || !ids.has(id)) continue;
    const plan = plans.find((item) => item.id === id)!;
    const type = occurrences.find((item) => item.planId === id && item.month === month)?.snapshot?.type ?? plan.type;
    if (type !== 'salary' && type !== 'fixed' && type !== 'annual') continue;
    if (entry.kind !== (type === 'salary' ? 'income' : 'expense')) continue;
    result.set(id, [...(result.get(id) ?? []), entry]);
  }
  return result;
}

/** Mantém previsão e realização separadas, preservando referências históricas da competência. */
export function rowsForMonth(plans: PlanItem[], occurrences: PlanOccurrence[], entries: Entry[], month: string): PlanningRow[] {
  monthIndex(month);
  const rows = new Map(occurrencesForMonth(plans, month).map((row) => [row.plan.id, row]));
  for (const occurrence of occurrences) {
    if (occurrence.month !== month || !occurrence.snapshot) continue;
    const plan = plans.find((item) => item.id === occurrence.planId);
    if (plan) rows.set(plan.id, rowFromSnapshot(plan, occurrence));
  }
  const linked = linkedEntriesForMonth(plans, occurrences, entries, month);
  for (const [id, items] of linked) {
    const plan = plans.find((item) => item.id === id)!;
    const entry = items[0];
    // O realizado informa a situação e a conferência, sem substituir a previsão.
    // Sem previsão ativa nem snapshot, um vínculo legado ainda precisa aparecer.
    const existing = rows.get(id) ?? {
      ...rowForPlan(plan, month),
      plan: { ...plan, description: entry.description },
      amountCents: safeSum(items.map((item) => item.amountCents)),
      dueOn: entry.dueOn,
    };
    rows.set(id, { ...existing, linkedEntry: entry });
  }
  return [...rows.values()].map((row) => ({ ...row, occurrence: occurrences.find((item) => item.planId === row.plan.id && item.month === month) }))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.plan.description.localeCompare(b.plan.description, 'pt-BR'));
}

/** Reserva reduz o valor livre, mas não é tratada como despesa de consumo nem como lançamento bancário. */
export function monthlyPlanningSummary(plans: PlanItem[], occurrences: PlanOccurrence[], entries: Entry[], month: string): MonthlyPlanningSummary {
  const rows = rowsForMonth(plans, occurrences, entries, month);
  // Um lançamento vinculado a outra competência também não é uma despesa variável deste mês.
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const occurrenceByEntry = new Map(occurrences.filter((item) => item.linkedEntryId).map((item) => [item.linkedEntryId!, item]));
  const linkedIds = new Set(entries.filter((value) => {
    const entry = value as LinkedEntry;
    const occurrence = entry.planId && isValidMonth(entry.planMonth)
      ? occurrences.find((item) => item.planId === entry.planId && item.month === entry.planMonth)
      : occurrenceByEntry.get(entry.id);
    const plan = planById.get(entry.planId && isValidMonth(entry.planMonth) ? entry.planId : occurrence?.planId ?? '');
    const type = occurrence?.snapshot?.type ?? plan?.type;
    return plan && (type === 'salary' || type === 'fixed' || type === 'annual')
      && entry.kind === (type === 'salary' ? 'income' : 'expense');
  }).map((entry) => entry.id));
  const unlinked = entries.filter((entry) => !linkedIds.has(entry.id) && entry.occurredOn.startsWith(`${month}-`));
  const amountFor = (type: PlanType) => safeSum(rows.filter((row) => row.plan.type === type).map((row) => row.amountCents));
  // Receita lançada manualmente pode ser o próprio salário já previsto: o vínculo é explícito.
  const expectedIncomeCents = amountFor('salary');
  const fixedCents = amountFor('fixed');
  const cardFixedCents = amountFor('cardFixed');
  const installmentCents = amountFor('installment');
  const annualCents = amountFor('annual');
  const reserveCents = amountFor('reserve');
  // A quitação de uma fatura já prevista nos itens de cartão permanece no caixa,
  // mas não deve consumir novamente o orçamento planejado.
  const variableCents = safeSum(unlinked.filter((entry) => entry.kind === 'expense' && (entry as Entry & { isCardPayment?: boolean }).isCardPayment !== true).map((entry) => entry.amountCents));
  const committedCents = safeSum([fixedCents, cardFixedCents, installmentCents, annualCents, reserveCents, variableCents]);
  return {
    expectedIncomeCents, fixedCents, cardFixedCents, installmentCents, annualCents, reserveCents, variableCents,
    committedCents, availableCents: safeSum([expectedIncomeCents, -committedCents]),
  };
}
