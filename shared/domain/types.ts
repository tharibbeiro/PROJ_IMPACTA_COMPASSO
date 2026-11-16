export type EntryKind = 'expense' | 'income';

export interface Account {
  id: string;
  name: string;
  type: 'bank' | 'cash';
  openingBalanceCents: number;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  kind: EntryKind;
  color: string;
}

export interface Entry {
  id: string;
  description: string;
  kind: EntryKind;
  amountCents: number;
  categoryId: string;
  accountId: string;
  occurredOn: string;
  dueOn: string;
  status: 'pending' | 'paid';
  paidOn?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Marca local para sair dos exemplos sem apagar lançamentos pessoais. */
  isExample?: boolean;
  /** Vínculo com uma previsão mensal; impede somar previsão e lançamento duas vezes. */
  planId?: string;
  planMonth?: string;
  /** Quitação bancária de fatura já prevista no orçamento dos cartões. */
  isCardPayment?: boolean;
}

export type EntryInput = Omit<Entry, 'id' | 'version' | 'createdAt' | 'updatedAt'>;

export interface Preferences {
  id: 'preferences';
  displayName: string;
  exampleMode: boolean;
}

export interface LocalOperation {
  id: string;
  entityId: string;
  type: 'create' | 'update' | 'settle' | 'delete';
  createdAt: string;
  expectedVersion?: number;
  payload: Entry | { id: string; version: number };
}

export interface FinanceSnapshot {
  accounts: Account[];
  categories: Category[];
  entries: Entry[];
  settings: Preferences;
}

export interface MonthSummary {
  /** Saldo realizado em todas as contas, incluindo os saldos iniciais. */
  balanceCents: number;
  /** Receitas e despesas pela data de ocorrência no mês selecionado. */
  incomeCents: number;
  expenseCents: number;
  /** Despesas ainda não pagas com vencimento no mês selecionado. */
  pendingCents: number;
  /** Entradas e saídas efetivas pela data de pagamento/recebimento. */
  paidIncomeCents: number;
  paidExpenseCents: number;
  monthlyBalanceCents: number;
  entriesCount: number;
}
