import type { Account, Entry, MonthSummary } from './types';

/** Converte moeda informada em reais para centavos, sem cálculos em ponto flutuante. */
export function parseMoney(raw: string): number {
  let value = raw.trim().replace(/^R\$\s*/i, '').replace(/[\s\u00a0]/g, '');
  const negative = value.startsWith('-');
  if (value.startsWith('-') || value.startsWith('+')) value = value.slice(1);
  if (!value) throw new Error('Informe um valor em reais.');

  let whole: string;
  let fraction = '';
  if (value.includes(',')) {
    const parts = value.split(',');
    if (parts.length !== 2 || !/^\d{1,2}$/.test(parts[1])) {
      throw new Error('Use até duas casas decimais para o valor.');
    }
    if (!/^\d+$/.test(parts[0]) && !/^\d{1,3}(\.\d{3})+$/.test(parts[0])) {
      throw new Error('Informe um valor válido, como 1.234,56.');
    }
    whole = parts[0].replace(/\./g, '');
    fraction = parts[1];
  } else if (/^\d{1,3}(\.\d{3})+$/.test(value)) {
    whole = value.replace(/\./g, '');
  } else if (/^\d+(\.\d{1,2})?$/.test(value)) {
    [whole, fraction = ''] = value.split('.');
  } else {
    throw new Error('Informe um valor válido, como 1.234,56.');
  }
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('O valor informado é muito alto.');
  return Number(cents) * (negative ? -1 : 1);
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatMoney(cents: number): string {
  return brl.format(cents / 100);
}

/** Data civil local: não converte o dia do aparelho para UTC. */
export function localDate(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 9999) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Filtra pela mesma referência usada no resumo, sem alterar a lista original. */
export function entriesForPeriod(entries: Entry[], month: string, basis: 'occurred' | 'paid'): Entry[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Selecione um mês válido.');
  return entries.filter((entry) => basis === 'paid'
    ? entry.status === 'paid' && Boolean(entry.paidOn?.startsWith(`${month}-`))
    : entry.occurredOn.startsWith(`${month}-`));
}

export function monthSummary(accounts: Account[], entries: Entry[], month: string): MonthSummary {
  const period = entriesForPeriod(entries, month, 'occurred');
  const sum = (items: Entry[], kind: Entry['kind']) => items
    .filter((entry) => entry.kind === kind)
    .reduce((total, entry) => total + entry.amountCents, 0);
  const paid = entries.filter((entry) => entry.status === 'paid');
  const paidInMonth = entriesForPeriod(entries, month, 'paid');
  const paidIncomeCents = sum(paidInMonth, 'income');
  const paidExpenseCents = sum(paidInMonth, 'expense');
  return {
    balanceCents: accounts.reduce((total, account) => total + account.openingBalanceCents, 0)
      + sum(paid, 'income') - sum(paid, 'expense'),
    incomeCents: sum(period, 'income'),
    expenseCents: sum(period, 'expense'),
    pendingCents: entries.filter((entry) => entry.status === 'pending' && entry.kind === 'expense' && entry.dueOn.startsWith(`${month}-`))
      .reduce((total, entry) => total + entry.amountCents, 0),
    paidIncomeCents,
    paidExpenseCents,
    monthlyBalanceCents: paidIncomeCents - paidExpenseCents,
    entriesCount: period.length,
  };
}

export function accountBalance(account: Account, entries: Entry[]): number {
  return entries.filter((entry) => entry.accountId === account.id && entry.status === 'paid')
    .reduce((total, entry) => total + (entry.kind === 'income' ? entry.amountCents : -entry.amountCents), account.openingBalanceCents);
}
