import { AppError, type AcademicState, type FinanceCommand } from '../contracts';
import { isValidDate, localDate } from '../../shared/domain/finance';
import { isValidMonth, rowsForMonth, snapshotForRow, validatePlanInput } from '../../shared/domain/planning';
import type { Account, Category, Entry, EntryInput } from '../../shared/domain/types';
import type { PlanInput, PlanItem, PlanOccurrence } from '../../shared/domain/planning-types';
import { parseBackup } from './backup';

function object(value: unknown, label = 'Dados'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError(`${label} inválidos.`, 400);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new AppError(`${label}: informe um texto de até ${max} caracteres.`, 400);
  return value.trim();
}

function optionalId(value: unknown): string | undefined {
  return value === undefined ? undefined : text(value, 'Identificador', 100);
}

function cents(value: unknown, negative = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || (!negative && value <= 0)) throw new AppError('Informe um valor válido em centavos inteiros.', 400);
  return value;
}

function month(value: unknown): string {
  if (!isValidMonth(value)) throw new AppError('Selecione um mês válido para o planejamento.', 400);
  return value;
}

function requireVersion(actual: number, expected: unknown): void {
  if (actual !== expected) throw new AppError('Este registro foi alterado. Atualize os dados antes de salvar novamente.', 409);
}

function bankPlan(plan: PlanItem): boolean {
  return plan.type === 'salary' || plan.type === 'fixed' || plan.type === 'annual';
}

function nextVersion(current = 0): number {
  if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) throw new AppError('A versão deste registro ultrapassa o limite permitido.', 400);
  return current + 1;
}

/** Regras de negócio síncronas e independentes da interface e do armazenamento. */
export class FinanceService {
  constructor(private readonly clock: () => Date = () => new Date()) {}

  apply(original: AcademicState, command: FinanceCommand): { state: AcademicState; result: unknown } {
    const state = structuredClone(original);
    try {
      const payload = object(command.payload, 'Parâmetros');
      let result: unknown;
      switch (command.type) {
        case 'saveEntry': result = this.saveEntry(state, payload.input, optionalId(payload.id), payload.expectedVersion); break;
        case 'settleEntry': result = this.settleEntry(state, text(payload.id, 'Lançamento', 100), payload.expectedVersion); break;
        case 'deleteEntry': result = this.deleteEntry(state, text(payload.id, 'Lançamento', 100), payload.expectedVersion); break;
        case 'addAccount': result = this.addAccount(state, payload.input); break;
        case 'updateAccount': result = this.updateAccount(state, text(payload.id, 'Conta', 100), payload.input); break;
        case 'addCategory': result = this.addCategory(state, payload.input); break;
        case 'savePreferences': result = this.savePreferences(state, payload.input); break;
        case 'restoreBackup': {
          const restored = parseBackup(payload.raw, this.today());
          this.checkLimits(restored);
          return { state: restored, result: undefined };
        }
        case 'savePlan': result = this.savePlan(state, payload.input, optionalId(payload.id), payload.expectedVersion); break;
        case 'deletePlan': result = this.deletePlan(state, text(payload.id, 'Planejamento', 100), payload.expectedVersion, month(payload.fromMonth ?? this.today().slice(0, 7))); break;
        case 'realizePlan': result = this.realizePlan(state, text(payload.planId, 'Planejamento', 100), month(payload.month)); break;
        case 'settlePlan': result = this.settlePlan(state, text(payload.planId, 'Planejamento', 100), month(payload.month), payload.options === undefined ? {} : object(payload.options, 'Pagamento')); break;
        case 'setPlanningChecked': result = this.setPlanningChecked(state, text(payload.planId, 'Planejamento', 100), month(payload.month), payload.checked); break;
        case 'linkPlanEntry': result = this.linkPlanEntry(state, text(payload.planId, 'Planejamento', 100), month(payload.month), text(payload.entryId, 'Lançamento', 100), payload.expectedVersion); break;
        case 'clearEntries': {
          for (const entry of state.entries) this.writeOccurrence(state, entry, true);
          state.entries = [];
          result = undefined;
          break;
        }
        default: throw new AppError('Comando financeiro não reconhecido.', 400);
      }
      this.checkLimits(state);
      return { state, result: structuredClone(result) };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(error instanceof Error ? error.message : 'Não foi possível aplicar o comando financeiro.', 400);
    }
  }

  private now(): string { return this.clock().toISOString(); }
  private today(): string { return localDate(this.clock()); }

  private checkLimits(state: AcademicState): void {
    if (state.accounts.length > 20 || state.categories.length > 100 || state.entries.length > 1000 || state.plans.length > 1000 || state.occurrences.length > 12000) throw new AppError('O limite de registros desta demonstração foi atingido. Reinicie a demonstração para continuar.', 400);
    let total = 0;
    const values = [...state.accounts.map((item) => item.openingBalanceCents), ...state.entries.map((item) => item.amountCents), ...state.plans.map((item) => item.amountCents)];
    for (const value of values) {
      const amount = Math.abs(value);
      // Verifica antes de somar para nunca produzir um inteiro arredondado.
      if (!Number.isSafeInteger(amount) || amount > Number.MAX_SAFE_INTEGER - total) {
        throw new AppError('A soma dos valores ultrapassa o limite seguro da demonstração.', 400);
      }
      total += amount;
    }
    for (const plan of state.plans) {
      if (plan.type === 'installment' && !Number.isSafeInteger(plan.amountCents * (plan.totalInstallments! - plan.installmentNumber!))) throw new AppError('O saldo futuro das parcelas ultrapassa o limite permitido.', 400);
    }
  }

  private account(state: AcademicState, id: string): Account {
    const account = state.accounts.find((item) => item.id === id);
    if (!account) throw new AppError('A conta selecionada não foi encontrada.', 404);
    return account;
  }

  private plan(state: AcademicState, id: string): PlanItem {
    const plan = state.plans.find((item) => item.id === id);
    if (!plan) throw new AppError('O compromisso do planejamento não foi encontrado.', 404);
    return plan;
  }

  private inputEntry(raw: unknown): EntryInput {
    const input = object(raw, 'Lançamento');
    if (input.kind !== 'expense' && input.kind !== 'income') throw new AppError('Escolha receita ou despesa.', 400);
    if (!isValidDate(input.occurredOn) || !isValidDate(input.dueOn)) throw new AppError('Informe datas válidas para o lançamento e o vencimento.', 400);
    if (input.status !== 'pending' && input.status !== 'paid') throw new AppError('A situação do lançamento é inválida.', 400);
    if (input.status === 'paid' && (!isValidDate(input.paidOn) || input.paidOn > this.today())) throw new AppError('Informe uma data de pagamento ou recebimento válida, até hoje.', 400);
    if ((input.planId === undefined) !== (input.planMonth === undefined)) throw new AppError('O vínculo com o planejamento está incompleto.', 400);
    if (input.planMonth !== undefined && !isValidMonth(input.planMonth)) throw new AppError('O mês do planejamento é inválido.', 400);
    if (input.isCardPayment !== undefined && typeof input.isCardPayment !== 'boolean') throw new AppError('A identificação de pagamento de fatura é inválida.', 400);
    if (input.isCardPayment && (input.kind !== 'expense' || input.planId)) throw new AppError('O pagamento de fatura deve ser uma despesa bancária sem vínculo com outro compromisso.', 400);
    return {
      description: text(input.description, 'Descrição'), kind: input.kind, amountCents: cents(input.amountCents),
      categoryId: text(input.categoryId, 'Categoria', 100), accountId: text(input.accountId, 'Conta', 100),
      occurredOn: input.occurredOn, dueOn: input.dueOn, status: input.status,
      ...(input.status === 'paid' ? { paidOn: input.paidOn as string } : {}),
      ...(input.planId !== undefined ? { planId: text(input.planId, 'Planejamento', 100), planMonth: input.planMonth as string } : {}),
      ...(input.isCardPayment ? { isCardPayment: true } : {}),
    };
  }

  private saveEntry(state: AcademicState, raw: unknown, id?: string, expectedVersion?: unknown): Entry {
    const input = object(raw, 'Lançamento');
    const clean = this.inputEntry(input);
    this.account(state, clean.accountId);
    const category = state.categories.find((item) => item.id === clean.categoryId);
    if (!category || category.kind !== clean.kind) throw new AppError('Escolha uma categoria compatível com o tipo do lançamento.', 400);
    const existing = id ? state.entries.find((entry) => entry.id === id) : undefined;
    if (id && !existing) throw new AppError('O lançamento não foi encontrado.', 404);
    if (existing) requireVersion(existing.version, expectedVersion);
    if (existing?.planId && clean.planId && (existing.planId !== clean.planId || existing.planMonth !== clean.planMonth)) throw new AppError('O vínculo de um lançamento com o planejamento não pode ser trocado.', 400);
    const planId = existing?.planId ?? clean.planId;
    const planMonth = existing?.planMonth ?? clean.planMonth;
    const isCardPayment = input.isCardPayment === undefined ? existing?.isCardPayment : input.isCardPayment;
    if (isCardPayment && (clean.kind !== 'expense' || planId)) throw new AppError('O pagamento de fatura deve ser uma despesa bancária sem vínculo com outro compromisso.', 400);
    if (planId) {
      const plan = this.plan(state, planId);
      if (!bankPlan(plan) || clean.kind !== (plan.type === 'salary' ? 'income' : 'expense')) throw new AppError('O planejamento vinculado ao lançamento é inválido.', 400);
      if (state.entries.some((entry) => entry.id !== id && entry.planId === planId && entry.planMonth === planMonth)) throw new AppError('Este compromisso já possui um lançamento vinculado no mês.', 409);
    }
    const entry: Entry = {
      ...clean, id: existing?.id ?? crypto.randomUUID(), version: nextVersion(existing?.version),
      createdAt: existing?.createdAt ?? this.now(), updatedAt: this.now(),
      ...(existing?.isExample ? { isExample: true } : {}), ...(planId ? { planId, planMonth } : {}),
      ...(isCardPayment ? { isCardPayment: true } : {}),
    };
    if (existing) state.entries[state.entries.indexOf(existing)] = entry;
    else state.entries.push(entry);
    this.writeOccurrence(state, entry);
    return entry;
  }

  private writeOccurrence(state: AcademicState, entry: Entry, removeLink = false): void {
    if (!entry.planId || !entry.planMonth) return;
    const plan = this.plan(state, entry.planId);
    const previous = state.occurrences.find((item) => item.planId === entry.planId && item.month === entry.planMonth);
    const occurrence: PlanOccurrence = {
      id: `${entry.planId}:${entry.planMonth}`, planId: entry.planId, month: entry.planMonth,
      status: !removeLink && entry.status === 'paid' ? 'done' : 'pending', updatedAt: this.now(),
      snapshot: previous?.snapshot ?? { type: plan.type, description: entry.description, amountCents: entry.amountCents, dueOn: entry.dueOn },
      ...(!removeLink ? { linkedEntryId: entry.id } : {}),
    };
    if (previous) state.occurrences[state.occurrences.indexOf(previous)] = occurrence;
    else state.occurrences.push(occurrence);
  }

  private settleEntry(state: AcademicState, id: string, expectedVersion: unknown): Entry {
    const entry = state.entries.find((item) => item.id === id);
    if (!entry) throw new AppError('O lançamento não foi encontrado.', 404);
    if (entry.status === 'paid') return entry;
    requireVersion(entry.version, expectedVersion);
    return this.saveEntry(state, { ...entry, status: 'paid', paidOn: this.today() }, id, entry.version);
  }

  private deleteEntry(state: AcademicState, id: string, expectedVersion: unknown): void {
    const entry = state.entries.find((item) => item.id === id);
    if (!entry) return;
    requireVersion(entry.version, expectedVersion);
    this.writeOccurrence(state, entry, true);
    state.entries = state.entries.filter((item) => item.id !== id);
  }

  private accountInput(raw: unknown): Pick<Account, 'name' | 'type' | 'openingBalanceCents'> {
    const input = object(raw, 'Conta');
    if (input.type !== 'bank' && input.type !== 'cash') throw new AppError('Escolha um tipo de conta válido.', 400);
    return { name: text(input.name, 'Nome da conta', 80), type: input.type, openingBalanceCents: cents(input.openingBalanceCents, true) };
  }

  private addAccount(state: AcademicState, raw: unknown): Account {
    const account: Account = { ...this.accountInput(raw), id: crypto.randomUUID(), createdAt: this.now() };
    state.accounts.push(account);
    return account;
  }

  private updateAccount(state: AcademicState, id: string, raw: unknown): Account {
    const existing = this.account(state, id);
    const account = { ...existing, ...this.accountInput(raw) };
    state.accounts[state.accounts.indexOf(existing)] = account;
    return account;
  }

  private addCategory(state: AcademicState, raw: unknown): Category {
    const input = object(raw, 'Categoria');
    const name = text(input.name, 'Nome da categoria', 80);
    if (input.kind !== 'expense' && input.kind !== 'income') throw new AppError('Escolha receita ou despesa para a categoria.', 400);
    if (typeof input.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(input.color)) throw new AppError('Escolha uma cor válida para a categoria.', 400);
    if (state.categories.some((category) => category.kind === input.kind && category.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) throw new AppError('Já existe uma categoria com esse nome e tipo.', 409);
    const category: Category = { id: crypto.randomUUID(), name, kind: input.kind, color: input.color };
    state.categories.push(category);
    return category;
  }

  private savePreferences(state: AcademicState, raw: unknown): void {
    const input = object(raw, 'Preferências');
    if (typeof input.displayName !== 'string' || input.displayName.trim().length > 60) throw new AppError('O nome deve ter até 60 caracteres.', 400);
    state.settings = { ...state.settings, displayName: input.displayName.trim(), exampleMode: false };
  }

  private savePlan(state: AcademicState, raw: unknown, id?: string, expectedVersion?: unknown): PlanItem {
    const clean = validatePlanInput(object(raw, 'Planejamento') as unknown as PlanInput);
    if (clean.accountId) this.account(state, clean.accountId);
    if (clean.categoryId && state.categories.find((item) => item.id === clean.categoryId)?.kind !== (clean.type === 'salary' ? 'income' : 'expense')) throw new AppError('Escolha uma categoria compatível com o planejamento.', 400);
    const existing = id ? this.plan(state, id) : undefined;
    if (existing) requireVersion(existing.version, expectedVersion);
    if (existing?.archived) throw new AppError('Este compromisso foi encerrado. Cadastre outro para iniciar uma nova previsão.', 409);
    if (existing && existing.type !== clean.type && state.occurrences.some((item) => item.planId === id)) throw new AppError('Um compromisso com registros mensais não pode mudar de tipo. Cadastre outro compromisso.', 400);
    const plan: PlanItem = { ...clean, id: existing?.id ?? crypto.randomUUID(), version: nextVersion(existing?.version), createdAt: existing?.createdAt ?? this.now(), updatedAt: this.now() };
    if (existing) state.plans[state.plans.indexOf(existing)] = plan;
    else state.plans.push(plan);
    return plan;
  }

  private deletePlan(state: AcademicState, id: string, expectedVersion: unknown, fromMonth: string): PlanItem {
    const plan = this.plan(state, id);
    requireVersion(plan.version, expectedVersion);
    if (plan.archived && plan.archivedFromMonth && plan.archivedFromMonth <= fromMonth) return plan;
    const archived: PlanItem = { ...plan, archived: true, archivedFromMonth: fromMonth, version: nextVersion(plan.version), updatedAt: this.now() };
    state.plans[state.plans.indexOf(plan)] = archived;
    return archived;
  }

  private findPlanEntry(state: AcademicState, planId: string, selectedMonth: string): Entry | undefined {
    const occurrence = state.occurrences.find((item) => item.planId === planId && item.month === selectedMonth);
    const entry = state.entries.find((item) => item.id === occurrence?.linkedEntryId) ?? state.entries.find((item) => item.planId === planId && item.planMonth === selectedMonth);
    if (entry) this.writeOccurrence(state, entry);
    return entry;
  }

  private realizePlan(state: AcademicState, planId: string, selectedMonth: string): Entry {
    const plan = this.plan(state, planId);
    if (!bankPlan(plan)) throw new AppError('Itens de cartão e reservas são conferidos no planejamento e não criam despesas bancárias.', 400);
    const existing = this.findPlanEntry(state, planId, selectedMonth);
    if (existing) return existing;
    const row = rowsForMonth([plan], state.occurrences, state.entries, selectedMonth)[0];
    if (!row) throw new AppError('Este compromisso não possui previsão no mês selecionado.', 400);
    return this.saveEntry(state, { description: row.plan.description, kind: plan.type === 'salary' ? 'income' : 'expense', amountCents: row.amountCents, categoryId: plan.categoryId, accountId: plan.accountId, occurredOn: row.dueOn, dueOn: row.dueOn, status: 'pending', planId, planMonth: selectedMonth });
  }

  private settlePlan(state: AcademicState, planId: string, selectedMonth: string, options: Record<string, unknown>): Entry {
    const paidOn = options.paidOn ?? this.today();
    if (!isValidDate(paidOn) || paidOn > this.today()) throw new AppError('Informe uma data de pagamento ou recebimento válida, até hoje.', 400);
    const entry = this.realizePlan(state, planId, selectedMonth);
    if (entry.status === 'paid') return entry;
    return this.saveEntry(state, { ...entry, status: 'paid', paidOn, accountId: options.accountId ?? entry.accountId }, entry.id, entry.version);
  }

  private setPlanningChecked(state: AcademicState, planId: string, selectedMonth: string, checked: unknown): PlanOccurrence {
    if (typeof checked !== 'boolean') throw new AppError('Informe uma situação válida para o compromisso.', 400);
    const plan = this.plan(state, planId);
    if (bankPlan(plan)) throw new AppError('Receitas e contas devem ser registradas ou pagas por um lançamento vinculado.', 400);
    const previous = state.occurrences.find((item) => item.planId === planId && item.month === selectedMonth);
    const row = rowsForMonth([plan], previous ? [previous] : [], [], selectedMonth)[0];
    if (!row) throw new AppError('Este compromisso não possui previsão no mês selecionado.', 400);
    const occurrence: PlanOccurrence = { id: `${planId}:${selectedMonth}`, planId, month: selectedMonth, status: checked ? 'done' : 'pending', updatedAt: this.now(), snapshot: previous?.snapshot ?? snapshotForRow(row) };
    if (previous) state.occurrences[state.occurrences.indexOf(previous)] = occurrence;
    else state.occurrences.push(occurrence);
    return occurrence;
  }

  private linkPlanEntry(state: AcademicState, planId: string, selectedMonth: string, entryId: string, expectedVersion?: unknown): Entry {
    const plan = this.plan(state, planId);
    if (!bankPlan(plan)) throw new AppError('Somente receitas e contas bancárias podem ser vinculadas a um lançamento.', 400);
    if (!rowsForMonth([plan], state.occurrences, state.entries, selectedMonth).length) throw new AppError('Este compromisso não possui previsão no mês selecionado.', 400);
    const entry = state.entries.find((item) => item.id === entryId);
    if (!entry) throw new AppError('O lançamento selecionado não foi encontrado.', 404);
    if (expectedVersion !== undefined) requireVersion(entry.version, expectedVersion);
    if (entry.kind !== (plan.type === 'salary' ? 'income' : 'expense') || !entry.occurredOn.startsWith(`${selectedMonth}-`)) throw new AppError('Escolha um lançamento do mesmo tipo e mês do planejamento.', 400);
    if (entry.planId && (entry.planId !== planId || entry.planMonth !== selectedMonth)) throw new AppError('Este lançamento já pertence a outro compromisso do planejamento.', 409);
    const current = this.findPlanEntry(state, planId, selectedMonth);
    if (current && current.id !== entryId) throw new AppError('Este compromisso já possui outro lançamento vinculado no mês.', 409);
    if (entry.planId === planId && entry.planMonth === selectedMonth) return entry;
    return this.saveEntry(state, { ...entry, planId, planMonth: selectedMonth }, entry.id, entry.version);
  }
}
