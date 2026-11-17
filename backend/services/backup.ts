import type { Account, Category, Entry, Preferences } from '../../shared/domain/types';
import type { PlanInput, PlanItem, PlanOccurrence, PlanningOccurrenceSnapshot } from '../../shared/domain/planning-types';
import { isValidDate } from '../../shared/domain/finance';
import { addMonths, isValidMonth, validatePlanInput } from '../../shared/domain/planning';
import { AppError, type AcademicState } from '../contracts';

const LIMITS = { bytes: 2_000_000, accounts: 20, categories: 100, entries: 1_000, plans: 1_000, occurrences: 12_000 } as const;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('A estrutura da cópia de segurança é inválida.');
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new AppError(`${label}: informe um texto de até ${max} caracteres.`);
  return value.trim();
}

function money(value: unknown, allowNegative = false): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && (allowNegative || value > 0);
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && isValidDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

function version(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function uniqueIds(items: Array<{ id: string }>): void {
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new AppError('A cópia contém identificadores duplicados.');
}

function array(value: unknown, label: string, maximum: number, required = false): unknown[] {
  if (!Array.isArray(value) || value.length > maximum || (required && !value.length)) {
    throw new AppError(`${label}: a cópia deve conter ${required ? 'entre 1 e' : 'até'} ${maximum} registros.`);
  }
  return value;
}

function parseSnapshot(value: unknown, plan: PlanItem, month: string): PlanningOccurrenceSnapshot | undefined {
  if (value === undefined) return undefined;
  const item = object(value);
  const bankItem = plan.type === 'salary' || plan.type === 'fixed' || plan.type === 'annual';
  if (item.type !== plan.type || !money(item.amountCents) || !isValidDate(item.dueOn)
      || (!bankItem && !item.dueOn.startsWith(`${month}-`))) throw new AppError('A cópia contém uma previsão mensal registrada inválida.');
  const description = text(item.description, 'Descrição registrada');
  const cardName = item.cardName === undefined ? undefined : text(item.cardName, 'Cartão registrado', 80);
  if ((plan.type === 'cardFixed' || plan.type === 'installment') && !cardName) throw new AppError('A cópia contém uma previsão de cartão sem identificação.');
  const result: PlanningOccurrenceSnapshot = {
    type: plan.type, description, amountCents: item.amountCents, dueOn: item.dueOn,
    ...(cardName ? { cardName } : {}),
  };
  if (plan.type === 'installment') {
    if (!Number.isInteger(item.installmentNumber) || !Number.isInteger(item.totalInstallments)
      || (item.installmentNumber as number) < 1 || (item.totalInstallments as number) > 1200
      || (item.installmentNumber as number) > (item.totalInstallments as number)
      || !Number.isInteger(item.remainingAfterThisMonth)
      || item.remainingAfterThisMonth !== (item.totalInstallments as number) - (item.installmentNumber as number)
      || !money(item.futureBalanceCents, true)
      || item.futureBalanceCents !== item.amountCents * (item.remainingAfterThisMonth as number)
      || !isValidDate(item.lastDueOn)
      || item.lastDueOn.slice(0, 7) !== addMonths(month, item.remainingAfterThisMonth as number)) {
      throw new AppError('A cópia contém parcelas registradas inválidas.');
    }
    Object.assign(result, {
      installmentNumber: item.installmentNumber, totalInstallments: item.totalInstallments,
      remainingAfterThisMonth: item.remainingAfterThisMonth, futureBalanceCents: item.futureBalanceCents, lastDueOn: item.lastDueOn,
    });
  }
  return result;
}

/** Contagem UTF-8 portátil: Apps Script V8 não fornece TextEncoder. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.codePointAt(index)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (code > 0xffff) index++;
  }
  return bytes;
}

function parse(raw: unknown, today?: string): AcademicState {
  if (today !== undefined && !isValidDate(today)) throw new AppError('A data de referência para a importação é inválida.');
  let parsed = raw;
  if (typeof raw === 'string') {
    if (utf8ByteLength(raw) > LIMITS.bytes) throw new AppError('A cópia de segurança deve ter até 2 MB.');
    try { parsed = JSON.parse(raw); } catch { throw new AppError('Não foi possível ler o arquivo JSON.'); }
  }
  const backup = object(parsed);
  if (backup.application !== 'compasso-academico' || (backup.version !== 1 && backup.version !== 2)) {
    throw new AppError('Importe somente uma cópia de demonstração do Compasso Acadêmico. Cópias do aplicativo pessoal não são aceitas.');
  }

  const accounts: Account[] = array(backup.accounts, 'Contas', LIMITS.accounts, true).map((value) => {
    const item = object(value);
    if ((item.type !== 'bank' && item.type !== 'cash') || !money(item.openingBalanceCents, true) || !timestamp(item.createdAt)) throw new AppError('A cópia contém uma conta inválida.');
    return { id: text(item.id, 'Identificador', 100), name: text(item.name, 'Conta', 80), type: item.type, openingBalanceCents: item.openingBalanceCents, createdAt: item.createdAt };
  });
  const categories: Category[] = array(backup.categories, 'Categorias', LIMITS.categories, true).map((value) => {
    const item = object(value);
    if ((item.kind !== 'expense' && item.kind !== 'income') || typeof item.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(item.color)) throw new AppError('A cópia contém uma categoria inválida.');
    return { id: text(item.id, 'Identificador', 100), name: text(item.name, 'Categoria', 80), kind: item.kind, color: item.color };
  });
  uniqueIds(accounts); uniqueIds(categories);
  const accountIds = new Set(accounts.map((account) => account.id));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const entries: Entry[] = array(backup.entries, 'Lançamentos', LIMITS.entries).map((value) => {
    const item = object(value);
    if ((item.kind !== 'expense' && item.kind !== 'income') || !money(item.amountCents)
      || !isValidDate(item.occurredOn) || !isValidDate(item.dueOn)
      || (item.status !== 'pending' && item.status !== 'paid') || !version(item.version)
      || !timestamp(item.createdAt) || !timestamp(item.updatedAt)) throw new AppError('A cópia contém um lançamento inválido.');
    if (item.status === 'paid' && (!isValidDate(item.paidOn) || (today !== undefined && item.paidOn > today))) throw new AppError('A cópia contém uma data de pagamento ou recebimento inválida.');
    const accountId = text(item.accountId, 'Conta', 100);
    const categoryId = text(item.categoryId, 'Categoria', 100);
    if (!accountIds.has(accountId) || categoryById.get(categoryId)?.kind !== item.kind) throw new AppError('A cópia contém um lançamento sem conta ou categoria compatível.');
    if ((item.planId === undefined) !== (item.planMonth === undefined)
      || (item.planMonth !== undefined && !isValidMonth(item.planMonth))) throw new AppError('A cópia contém um vínculo de planejamento incompleto.');
    const planId = item.planId === undefined ? undefined : text(item.planId, 'Planejamento', 100);
    if (item.isCardPayment !== undefined && typeof item.isCardPayment !== 'boolean') throw new AppError('A identificação de pagamento de fatura é inválida.');
    if (item.isCardPayment && (item.kind !== 'expense' || planId)) throw new AppError('O pagamento de fatura deve ser uma despesa sem vínculo com outro compromisso.');
    if (item.isExample !== undefined && typeof item.isExample !== 'boolean') throw new AppError('A cópia contém metadados inválidos.');
    return {
      id: text(item.id, 'Identificador', 100), description: text(item.description, 'Descrição'), kind: item.kind,
      amountCents: item.amountCents, accountId, categoryId, occurredOn: item.occurredOn, dueOn: item.dueOn,
      status: item.status, version: item.version, createdAt: item.createdAt, updatedAt: item.updatedAt,
      ...(item.status === 'paid' ? { paidOn: item.paidOn as string } : {}),
      ...(planId ? { planId, planMonth: item.planMonth as string } : {}),
      ...(item.isCardPayment ? { isCardPayment: true } : {}),
      ...(typeof item.isExample === 'boolean' ? { isExample: item.isExample } : {}),
    };
  });
  uniqueIds(entries);

  const plans: PlanItem[] = array(backup.version === 2 ? backup.plans : [], 'Planejamentos', LIMITS.plans).map((value) => {
    const item = object(value);
    const clean = validatePlanInput(item as unknown as PlanInput);
    if (!version(item.version) || !timestamp(item.createdAt) || !timestamp(item.updatedAt)
      || (item.archived !== undefined && typeof item.archived !== 'boolean')
      || (item.archivedFromMonth !== undefined && (!isValidMonth(item.archivedFromMonth) || item.archived !== true))) throw new AppError('A cópia contém um planejamento inválido.');
    if (clean.accountId && !accountIds.has(clean.accountId)) throw new AppError('O planejamento contém uma conta inexistente.');
    if (clean.categoryId && categoryById.get(clean.categoryId)?.kind !== (clean.type === 'salary' ? 'income' : 'expense')) throw new AppError('O planejamento contém uma categoria incompatível.');
    return {
      ...clean, id: text(item.id, 'Planejamento', 100), version: item.version, createdAt: item.createdAt, updatedAt: item.updatedAt,
      ...(typeof item.archived === 'boolean' ? { archived: item.archived } : {}),
      ...(typeof item.archivedFromMonth === 'string' ? { archivedFromMonth: item.archivedFromMonth } : {}),
    };
  });
  uniqueIds(plans);
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const planEntryKeys = new Set<string>();
  for (const entry of entries) {
    if (!entry.planId) continue;
    const plan = planById.get(entry.planId);
    const key = `${entry.planId}:${entry.planMonth}`;
    if (!plan || !['salary', 'fixed', 'annual'].includes(plan.type)
      || entry.kind !== (plan.type === 'salary' ? 'income' : 'expense') || planEntryKeys.has(key)) throw new AppError('A cópia contém um vínculo de planejamento inválido ou duplicado.');
    planEntryKeys.add(key);
  }

  const occurrenceKeys = new Set<string>();
  const occurrenceIds = new Set<string>();
  const linkedIds = new Set<string>();
  const occurrences: PlanOccurrence[] = array(backup.version === 2 ? backup.occurrences : [], 'Ocorrências', LIMITS.occurrences).map((value) => {
    const item = object(value);
    const suppliedId = text(item.id, 'Ocorrência', 120);
    const planId = text(item.planId, 'Planejamento', 100);
    const plan = planById.get(planId);
    if (!plan || !isValidMonth(item.month) || (item.status !== 'pending' && item.status !== 'done') || !timestamp(item.updatedAt)) throw new AppError('A cópia contém uma ocorrência inválida.');
    const key = `${planId}:${item.month}`;
    if (occurrenceKeys.has(key) || occurrenceIds.has(suppliedId)) throw new AppError('A cópia contém ocorrências duplicadas.');
    occurrenceKeys.add(key); occurrenceIds.add(suppliedId);
    const linkedEntryId = item.linkedEntryId === undefined ? undefined : text(item.linkedEntryId, 'Lançamento', 100);
    if (linkedEntryId) {
      const entry = entryById.get(linkedEntryId);
      if (!entry || entry.planId !== planId || entry.planMonth !== item.month || linkedIds.has(linkedEntryId)
        || item.status !== (entry.status === 'paid' ? 'done' : 'pending')) throw new AppError('A cópia contém um lançamento vinculado incompatível.');
      linkedIds.add(linkedEntryId);
    } else if (['salary', 'fixed', 'annual'].includes(plan.type) && item.status === 'done') throw new AppError('A cópia contém pagamento sem lançamento correspondente.');
    const savedSnapshot = parseSnapshot(item.snapshot, plan, item.month);
    return {
      id: key, planId, month: item.month, status: item.status, updatedAt: item.updatedAt,
      ...(linkedEntryId ? { linkedEntryId } : {}), ...(savedSnapshot ? { snapshot: savedSnapshot } : {}),
    };
  });
  for (const entry of entries) {
    if (entry.planId && !linkedIds.has(entry.id)) throw new AppError('A cópia contém um lançamento sem ocorrência de planejamento.');
  }
  const rawSettings = object(backup.settings);
  if (rawSettings.id !== 'preferences' || typeof rawSettings.displayName !== 'string' || rawSettings.displayName.length > 60
    || typeof rawSettings.exampleMode !== 'boolean') throw new AppError('As preferências da cópia são inválidas.');
  const settings: Preferences = { id: 'preferences', displayName: rawSettings.displayName.trim(), exampleMode: false };
  return { accounts, categories, entries, settings, plans, occurrences };
}

/** Valida sem mutar o objeto recebido; retorna estruturas novas prontas para armazenamento em memória. */
export function parseBackup(raw: unknown, today?: string): AcademicState {
  try { return parse(raw, today); }
  catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(error instanceof Error ? error.message : 'A cópia de segurança é inválida.');
  }
}
