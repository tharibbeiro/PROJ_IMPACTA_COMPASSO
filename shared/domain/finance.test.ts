import { describe, expect, it } from 'vitest';
import { accountBalance, entriesForPeriod, isValidDate, localDate, monthSummary, parseMoney } from './finance';
import type { Account, Entry } from './types';

describe('valores em centavos', () => {
  it.each([
    ['R$ 1.234,56', 123456], ['0,01', 1], ['10,1', 1010], ['125.50', 12550],
    ['1.200', 120000], ['-32,90', -3290], ['0', 0], ['123456789,99', 12345678999],
    ['90.071.992.547.409,91', Number.MAX_SAFE_INTEGER],
    ['-90071992547409,91', -Number.MAX_SAFE_INTEGER],
    ['90071992547409,90', Number.MAX_SAFE_INTEGER - 1],
    ['000000000000000000000000000,01', 1],
  ])('converte %s sem arredondamento', (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it.each(['', '1,234', '12.34,56', '1e3', 'NaN', 'Infinity', '--1', '90071992547410,00', '90071992547409,92', '-90071992547409,92'])('rejeita %s', (input) => {
    expect(() => parseMoney(input)).toThrow();
  });
});

describe('datas e relatórios', () => {
  const account: Account = { id: 'account', name: 'Conta', type: 'bank', openingBalanceCents: 10000, createdAt: '2026-01-01T00:00:00.000Z' };
  const base: Entry = { id: 'entry', description: 'Exemplo', kind: 'expense', amountCents: 2000, categoryId: 'category', accountId: 'account', occurredOn: '2026-01-31', dueOn: '2026-02-10', status: 'pending', version: 1, createdAt: '2026-01-31T00:00:00.000Z', updatedAt: '2026-01-31T00:00:00.000Z' };

  it('separa competência, vencimento e pagamento', () => {
    const entries: Entry[] = [
      base,
      { ...base, id: 'paid', amountCents: 1500, status: 'paid', paidOn: '2026-02-02' },
      { ...base, id: 'income', kind: 'income', amountCents: 5000, status: 'paid', occurredOn: '2026-02-01', paidOn: '2026-02-01' },
    ];
    const january = monthSummary([account], entries, '2026-01');
    const february = monthSummary([account], entries, '2026-02');
    expect(january.expenseCents).toBe(3500);
    expect(january.pendingCents).toBe(0);
    expect(january.paidExpenseCents).toBe(0);
    expect(february.pendingCents).toBe(2000);
    expect(february.paidExpenseCents).toBe(1500);
    expect(february.incomeCents).toBe(5000);
    expect(february.balanceCents).toBe(13500);
    expect(accountBalance(account, entries)).toBe(13500);
  });

  it('valida dias reais de calendário', () => {
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2026-04-31')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-1-01')).toBe(false);
    expect(localDate(new Date(2026, 10, 7, 23, 59))).toBe('2026-11-07');
  });

  it('mantém o detalhamento coerente quando ocorrência e pagamento estão em meses diferentes', () => {
    const settled: Entry = { ...base, id: 'october-expense', occurredOn: '2026-10-22', dueOn: '2026-11-10', status: 'paid', paidOn: '2026-11-03' };
    const pending: Entry = { ...base, id: 'november-pending', occurredOn: '2026-11-04', dueOn: '2026-11-15', paidOn: '2026-11-05' };
    const entries = [settled, pending];

    expect(entriesForPeriod(entries, '2026-11', 'paid')).toEqual([settled]);
    expect(entriesForPeriod(entries, '2026-10', 'occurred')).toEqual([settled]);
    expect(entriesForPeriod(entries, '2026-11', 'occurred')).toEqual([pending]);
    expect(entriesForPeriod(entries, '2026-10', 'paid')).toEqual([]);
    expect(entries).toEqual([settled, pending]);
  });

  it.each(['', '2026', '2026-1', '2026-00', '2026-13', '2026-11-01'])('rejeita mês inválido %s nas duas referências e no resumo', (month) => {
    expect(() => entriesForPeriod([base], month, 'occurred')).toThrow('mês válido');
    expect(() => entriesForPeriod([base], month, 'paid')).toThrow('mês válido');
    expect(() => monthSummary([account], [base], month)).toThrow('mês válido');
  });
});
