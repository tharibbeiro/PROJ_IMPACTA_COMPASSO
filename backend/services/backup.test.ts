import { describe, expect, it } from 'vitest';
import { AppError } from '../contracts';
import { parseBackup, utf8ByteLength } from './backup';

const time = '2026-11-01T00:00:00.000Z';

function fixture() {
  return {
    application: 'compasso-academico', version: 2, exportedAt: time,
    accounts: [{ id: 'account', name: 'Conta fictícia', type: 'bank', openingBalanceCents: 5000, createdAt: time }],
    categories: [
      { id: 'income', name: 'Receita fictícia', kind: 'income', color: '#123abc' },
      { id: 'expense', name: 'Despesa fictícia', kind: 'expense', color: '#abcdef' },
    ],
    entries: [{
      id: 'receipt', description: 'Recebimento fictício', kind: 'income', amountCents: 10000,
      accountId: 'account', categoryId: 'income', occurredOn: '2026-11-05', dueOn: '2026-12-02',
      status: 'paid', paidOn: '2026-11-10', version: 2, createdAt: time, updatedAt: time,
      planId: 'salary', planMonth: '2026-11',
    }],
    settings: { id: 'preferences', displayName: 'Turma de exemplo', exampleMode: false },
    plans: [
      { id: 'salary', type: 'salary', description: 'Salário fictício', amountCents: 11000, startMonth: '2026-11', dueDay: 5, accountId: 'account', categoryId: 'income', version: 1, createdAt: time, updatedAt: time },
      { id: 'installment', type: 'installment', description: 'Compra fictícia', amountCents: 1000, startMonth: '2026-11', dueDay: 31, cardName: 'Cartão fictício', installmentNumber: 2, totalInstallments: 4, version: 1, createdAt: time, updatedAt: time },
    ],
    occurrences: [
      { id: 'salary:2026-11', planId: 'salary', month: '2026-11', status: 'done', linkedEntryId: 'receipt', updatedAt: time, snapshot: { type: 'salary', description: 'Salário fictício da época', amountCents: 10000, dueOn: '2026-12-02' } },
      { id: 'installment:2026-11', planId: 'installment', month: '2026-11', status: 'done', updatedAt: time, snapshot: { type: 'installment', description: 'Compra fictícia da época', amountCents: 1000, dueOn: '2026-11-30', cardName: 'Cartão fictício', installmentNumber: 2, totalInstallments: 4, remainingAfterThisMonth: 2, futureBalanceCents: 2000, lastDueOn: '2027-01-31' } },
    ],
  };
}

describe('validação pura de cópias acadêmicas', () => {
  it('conta bytes UTF-8 sem depender de APIs web no Apps Script', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('Açã😀\ud800')).toBe(12);
    expect(utf8ByteLength('')).toBe(0);
  });
  it('faz roundtrip v2 preservando vínculos e snapshots, com cópias defensivas', () => {
    const backup = fixture();
    const parsed = parseBackup(JSON.stringify(backup), '2026-11-14');
    expect(parsed.entries[0]).toEqual(backup.entries[0]);
    expect(parsed.plans).toEqual(backup.plans);
    expect(parsed.occurrences).toEqual(backup.occurrences);
    expect(parsed.accounts).toEqual(backup.accounts);
    const cloned = parseBackup(backup);
    cloned.accounts[0].name = 'Mudança local';
    cloned.entries[0].amountCents = 123;
    cloned.occurrences[0].snapshot!.description = 'Mudança da cópia';
    expect(backup.accounts[0].name).toBe('Conta fictícia');
    expect(backup.entries[0].amountCents).toBe(10000);
    expect(backup.occurrences[0].snapshot.description).toBe('Salário fictício da época');
  });

  it('aceita v1 acadêmica, normaliza o modo demo e mantém marcadores permitidos', () => {
    const backup: Record<string, unknown> = fixture();
    backup.version = 1;
    backup.entries = [{
      ...fixture().entries[0], id: 'card-payment', kind: 'expense', categoryId: 'expense',
      planId: undefined, planMonth: undefined, isCardPayment: true, isExample: false,
    }];
    backup.settings = { id: 'preferences', displayName: '  Turma  ', exampleMode: true };
    delete backup.plans; delete backup.occurrences;
    const result = parseBackup(backup);
    expect(result.plans).toEqual([]);
    expect(result.occurrences).toEqual([]);
    expect(result.settings).toEqual({ id: 'preferences', displayName: 'Turma', exampleMode: false });
    expect(result.entries[0]).toMatchObject({ isCardPayment: true, isExample: false });
  });

  it('rejeita cópias pessoais, versões desconhecidas e JSON inválido com AppError', () => {
    const personal = { ...fixture(), application: 'compasso-financas' };
    expect(() => parseBackup(personal)).toThrow('pessoal');
    expect(() => parseBackup({ ...fixture(), version: 99 })).toThrow(AppError);
    expect(() => parseBackup('{')).toThrow(AppError);
    expect(() => parseBackup(null)).toThrow(AppError);
  });

  it('rejeita referências inválidas e não modifica o objeto recebido', () => {
    const wrongAccount = fixture();
    wrongAccount.entries[0].accountId = 'missing';
    const untouched = JSON.stringify(wrongAccount);
    expect(() => parseBackup(wrongAccount)).toThrow('conta');
    expect(JSON.stringify(wrongAccount)).toBe(untouched);
    const wrongLink = fixture();
    wrongLink.occurrences[0].linkedEntryId = 'missing';
    expect(() => parseBackup(wrongLink)).toThrow('vinculado');
    const orphaned = fixture();
    orphaned.occurrences = orphaned.occurrences.slice(1);
    expect(() => parseBackup(orphaned)).toThrow('ocorrência');
  });

  it('permite vencimento bancário em outro mês, mas protege mês e saldo das parcelas', () => {
    expect(() => parseBackup(fixture())).not.toThrow();
    const wrongMonth = fixture();
    wrongMonth.occurrences[1].snapshot.dueOn = '2026-12-01';
    expect(() => parseBackup(wrongMonth)).toThrow('previsão');
    const wrongBalance = fixture();
    wrongBalance.occurrences[1].snapshot.futureBalanceCents = 1;
    expect(() => parseBackup(wrongBalance)).toThrow('parcelas');
    const wrongPayoff = fixture();
    wrongPayoff.occurrences[1].snapshot.lastDueOn = '2027-02-28';
    expect(() => parseBackup(wrongPayoff)).toThrow('parcelas');
  });

  it('aplica limites de registros e tamanho UTF-8 antes de processar o conteúdo', () => {
    const tooMany = fixture();
    tooMany.accounts = Array.from({ length: 21 }, (_, index) => ({ ...tooMany.accounts[0], id: `account-${index}` }));
    expect(() => parseBackup(tooMany)).toThrow('20');
    expect(() => parseBackup('é'.repeat(1_000_001))).toThrow('2 MB');
  });

  it('rejeita IDs e pares plano-mês duplicados', () => {
    const duplicateEntry = fixture();
    duplicateEntry.entries.push({ ...duplicateEntry.entries[0] });
    expect(() => parseBackup(duplicateEntry)).toThrow('duplicados');
    const duplicateOccurrence = fixture();
    duplicateOccurrence.occurrences.push({ ...duplicateOccurrence.occurrences[0], id: 'different-id' });
    expect(() => parseBackup(duplicateOccurrence)).toThrow('duplicadas');
  });

  it('usa a data de referência injetada para validar pagamentos sem depender do relógio global', () => {
    expect(() => parseBackup(fixture(), '2026-11-09')).toThrow('pagamento');
    expect(() => parseBackup(fixture(), '2026-11-10')).not.toThrow();
    expect(() => parseBackup(fixture())).not.toThrow();
    expect(() => parseBackup(fixture(), '2026-02-30')).toThrow('referência');
  });
});
