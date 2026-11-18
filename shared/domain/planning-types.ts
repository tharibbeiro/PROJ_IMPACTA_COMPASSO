import type { Entry } from './types';

export type PlanType = 'salary' | 'fixed' | 'cardFixed' | 'installment' | 'annual' | 'reserve';

export interface PlanItem {
  id: string;
  type: PlanType;
  description: string;
  amountCents: number;
  startMonth: string;
  dueDay: number;
  categoryId?: string;
  accountId?: string;
  cardName?: string;
  installmentNumber?: number;
  totalInstallments?: number;
  endMonth?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  archived?: boolean;
  archivedFromMonth?: string;
}

export type PlanInput = Omit<PlanItem, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'archived' | 'archivedFromMonth'>;

/** Confirmação do mês, enviada junto da previsão em uma única operação. */
export interface PlanCompletionInput {
  month: string;
  completed: boolean;
  paidOn?: string;
  expectedEntryVersion?: number;
}

export interface PlanningOccurrenceSnapshot {
  type: PlanType;
  description: string;
  amountCents: number;
  dueOn: string;
  cardName?: string;
  installmentNumber?: number;
  totalInstallments?: number;
  remainingAfterThisMonth?: number;
  futureBalanceCents?: number;
  lastDueOn?: string;
}

export interface PlanOccurrence {
  id: string;
  planId: string;
  month: string;
  status: 'pending' | 'done';
  linkedEntryId?: string;
  updatedAt: string;
  /** Congela a referência do mês quando registrado ou conferido pela primeira vez. */
  snapshot?: PlanningOccurrenceSnapshot;
}

export interface PlanningSnapshot {
  plans: PlanItem[];
  occurrences: PlanOccurrence[];
}

export interface PlanningRow {
  plan: PlanItem;
  month: string;
  amountCents: number;
  dueOn: string;
  installmentNumber?: number;
  remainingAfterThisMonth?: number;
  futureBalanceCents?: number;
  lastDueOn?: string;
  /** Presente somente quando há lançamento financeiro vinculado. */
  linkedEntry?: Entry;
  occurrence?: PlanOccurrence;
}

export interface MonthlyPlanningSummary {
  /** Previsões de salário/adiantamento, substituídas pelo valor real quando vinculadas. */
  expectedIncomeCents: number;
  fixedCents: number;
  cardFixedCents: number;
  installmentCents: number;
  annualCents: number;
  reserveCents: number;
  /** Despesas registradas no mês sem vínculo válido a um item planejado. */
  variableCents: number;
  /** Compromissos + reservas + despesas variáveis. */
  committedCents: number;
  availableCents: number;
}
