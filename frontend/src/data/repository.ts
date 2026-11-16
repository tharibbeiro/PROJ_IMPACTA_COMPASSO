import Dexie, { type Table } from 'dexie';
import type { Account, Category, Entry, EntryInput, FinanceSnapshot, LocalOperation, Preferences } from '../domain/types';
import type { PlanItem, PlanOccurrence } from '../domain/planning-types';
import {
  ApiRequestError, createDemoSession, fetchBootstrap, sendCommand, serializeRemoteOperation,
} from './api-client';
import type { AcademicCommandType, AcademicState, StateEnvelope } from './api-client';

interface ServerCacheMetadata {
  id: 'server';
  revision: number;
  epoch: string;
  updatedAt: string;
}

/** Cache de leitura da API acadêmica. Nunca acessa o banco do aplicativo pessoal. */
class AcademicCacheDatabase extends Dexie {
  accounts!: Table<Account, string>;
  categories!: Table<Category, string>;
  entries!: Table<Entry, string>;
  settings!: Table<Preferences, string>;
  plans!: Table<PlanItem, string>;
  planOccurrences!: Table<PlanOccurrence, string>;
  /** Mantida vazia para compatibilidade; não existe fila de escrita offline. */
  operations!: Table<LocalOperation, string>;
  metadata!: Table<ServerCacheMetadata, string>;

  constructor() {
    super('compasso-academico-cache');
    this.version(1).stores({
      accounts: 'id, name',
      categories: 'id, kind',
      entries: 'id, accountId, categoryId, occurredOn, dueOn, status, &[planId+planMonth]',
      settings: 'id',
      plans: 'id, type, startMonth',
      planOccurrences: 'id, &[planId+month], planId, month, &linkedEntryId',
      operations: 'id, entityId, createdAt',
      metadata: 'id',
    });
  }
}

export const db = new AcademicCacheDatabase();

/** Substitui apenas o cache após confirmação do servidor, em uma transação local. */
async function applyServerState(envelope: StateEnvelope, options: { reset?: boolean; expectedEpoch?: string } = {}): Promise<void> {
  await db.transaction('rw', [db.accounts, db.categories, db.entries, db.settings, db.plans, db.planOccurrences, db.operations, db.metadata], async () => {
    const current = await db.metadata.get('server');
    if (!options.reset) {
      if (options.expectedEpoch !== current?.epoch) {
        throw new Error('A sessão da demonstração mudou em outra aba. Atualize a página antes de continuar.');
      }
      if (current && envelope.revision < current.revision) return;
    }
    const { state } = envelope;
    await Promise.all([
      db.accounts.clear(), db.categories.clear(), db.entries.clear(), db.settings.clear(),
      db.plans.clear(), db.planOccurrences.clear(), db.operations.clear(),
    ]);
    if (state.accounts.length) await db.accounts.bulkAdd(state.accounts);
    if (state.categories.length) await db.categories.bulkAdd(state.categories);
    if (state.entries.length) await db.entries.bulkAdd(state.entries);
    await db.settings.add(state.settings);
    if (state.plans.length) await db.plans.bulkAdd(state.plans);
    if (state.occurrences.length) await db.planOccurrences.bulkAdd(state.occurrences);
    await db.metadata.put({
      id: 'server', revision: envelope.revision,
      epoch: options.reset ? crypto.randomUUID() : current?.epoch ?? crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
    });
  });
}

let initialization: Promise<void> | null = null;

/** Obtém a sessão da API. Sem rede, permite apenas ler um cache já confirmado. */
export function initialize(): Promise<void> {
  if (initialization) return initialization;
  const pending = serializeRemoteOperation(async () => {
    const previous = await db.metadata.get('server');
    let sessionWasRejected = false;
    try {
      let response: StateEnvelope;
      let reset = false;
      try { response = await fetchBootstrap(); }
      catch (error) {
        if (!(error instanceof ApiRequestError) || error.status !== 401) throw error;
        sessionWasRejected = true;
        response = await createDemoSession();
        reset = true;
      }
      await applyServerState(response, { reset, expectedEpoch: previous?.epoch });
    } catch (error) {
      // Um 401 não pode reapresentar a sessão anterior como se ainda fosse válida.
      if (sessionWasRejected || !(error instanceof ApiRequestError) || error.kind !== 'network') throw error;
      const [metadata, settings] = await Promise.all([db.metadata.get('server'), db.settings.get('preferences')]);
      if (!metadata || !settings) throw error;
      // A falha não gera contas, categorias ou lançamentos fictícios no navegador.
    }
  });
  initialization = pending.finally(() => { initialization = null; });
  return initialization;
}

export const refreshFromServer = initialize;

export async function snapshot(): Promise<FinanceSnapshot> {
  return db.transaction('r', db.accounts, db.categories, db.entries, db.settings, async () => {
    const [accounts, categories, entries, settings] = await Promise.all([
      db.accounts.toArray(), db.categories.toArray(), db.entries.toArray(), db.settings.get('preferences'),
    ]);
    if (!settings) throw new Error('Abra a demonstração com internet para carregar os dados do servidor pela primeira vez.');
    return {
      accounts: accounts.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      categories: categories.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
      entries: entries.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt)),
      settings,
    };
  });
}

/** Todos os comandos financeiros passam pela API. Não há gravação local alternativa. */
export function runRemoteCommand<Result>(type: AcademicCommandType, payload: object): Promise<Result> {
  return serializeRemoteOperation(async () => {
    const previous = await db.metadata.get('server');
    const response = await sendCommand<Result>(type, payload);
    await applyServerState(response, { expectedEpoch: previous?.epoch });
    return response.result as Result;
  });
}

export function saveEntry(input: EntryInput, id?: string, expectedVersion?: number): Promise<Entry> {
  return runRemoteCommand('saveEntry', { input, ...(id ? { id } : {}), ...(expectedVersion === undefined ? {} : { expectedVersion }) });
}

export function settleEntry(id: string, expectedVersion: number): Promise<Entry> {
  return runRemoteCommand('settleEntry', { id, expectedVersion });
}

export async function deleteEntry(id: string, expectedVersion: number): Promise<void> {
  await runRemoteCommand('deleteEntry', { id, expectedVersion });
}

export function addAccount(input: Pick<Account, 'name' | 'type' | 'openingBalanceCents'>): Promise<Account> {
  return runRemoteCommand('addAccount', { input });
}

export function updateAccount(id: string, input: Pick<Account, 'name' | 'type' | 'openingBalanceCents'>): Promise<Account> {
  return runRemoteCommand('updateAccount', { id, input });
}

export function addCategory(input: Pick<Category, 'name' | 'kind' | 'color'>): Promise<Category> {
  return runRemoteCommand('addCategory', { input });
}

export async function savePreferences(input: { displayName: string }): Promise<void> {
  await runRemoteCommand('savePreferences', { input });
}

export async function exportBackup(): Promise<string> {
  return db.transaction('r', [db.accounts, db.categories, db.entries, db.settings, db.plans, db.planOccurrences], async () => {
    const [data, plans, occurrences] = await Promise.all([snapshot(), db.plans.toArray(), db.planOccurrences.toArray()]);
    return JSON.stringify({ application: 'compasso-academico', version: 2, exportedAt: new Date().toISOString(), ...data, plans, occurrences }, null, 2);
  });
}

export async function restoreBackup(raw: string): Promise<void> {
  if (typeof raw !== 'string' || raw.length > 10_000_000) throw new Error('Escolha uma cópia acadêmica de até 10 MB.');
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error('Não foi possível ler o arquivo JSON.'); }
  if (!value || typeof value !== 'object' || (value as { application?: unknown }).application !== 'compasso-academico'
      || (value as { version?: unknown }).version !== 2) {
    // Rejeita antes do HTTP para não enviar uma cópia pessoal ao servidor acadêmico.
    throw new Error('Importe somente uma cópia da demonstração acadêmica. Cópias pessoais do Compasso não são enviadas a este servidor.');
  }
  await runRemoteCommand('restoreBackup', { raw });
}

async function restartDemo(): Promise<void> {
  await serializeRemoteOperation(async () => {
    const response = await createDemoSession();
    await applyServerState(response, { reset: true });
  });
}

/** Nova sessão remota com dados sintéticos, sem importar o banco pessoal. */
export const seedExampleData = restartDemo;
export const resetExampleData = restartDemo;

export async function clearEntries(): Promise<void> {
  await runRemoteCommand('clearEntries', {});
}

export type { AcademicState };
