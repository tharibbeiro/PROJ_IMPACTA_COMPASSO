import type { Account, Category, Entry, EntryInput, FinanceSnapshot } from '../domain/types';
import {
  ApiRequestError, createDemoSession, fetchBootstrap, sendCommand, serializeRemoteOperation,
} from './api-client';
import type { AcademicCommandType, AcademicState, StateEnvelope } from './api-client';

// A cópia de consulta existe somente enquanto a aba estiver aberta.
// A fonte dos dados é o Google Sheets, acessado pelo Apps Script.
let cachedState: AcademicState | null = null;
let revision = -1;
let epoch = 0;
const listeners = new Set<() => void>();

export function subscribeState(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getCachedState(): AcademicState {
  if (!cachedState) throw new Error('Abra o Compasso no Google Apps Script com internet para carregar os dados.');
  return JSON.parse(JSON.stringify(cachedState)) as AcademicState;
}

function applyServerState(envelope: StateEnvelope, options: { reset?: boolean; expectedEpoch?: number } = {}): void {
  if (!options.reset && options.expectedEpoch !== epoch) throw new Error('A sessão foi alterada. Atualize o aplicativo antes de continuar.');
  if (!options.reset && envelope.revision < revision) return;
  const next = JSON.parse(JSON.stringify(envelope.state)) as AcademicState;
  cachedState = next;
  revision = envelope.revision;
  if (options.reset) epoch++;
  for (const listener of listeners) {
    // Uma falha de apresentação não desfaz uma gravação já confirmada no servidor.
    try { listener(); } catch { /* A interface trata seu próprio erro de leitura. */ }
  }
}

let initialization: Promise<void> | null = null;

/** Carrega dados confirmados pelo Apps Script; não gera exemplos locais. */
export function initialize(): Promise<void> {
  if (initialization) return initialization;
  const pending = serializeRemoteOperation(async () => {
    const previousEpoch = epoch;
    let response: StateEnvelope;
    let reset = false;
    try { response = await fetchBootstrap(); }
    catch (error) {
      if (!(error instanceof ApiRequestError) || error.status !== 401) throw error;
      response = await createDemoSession({ ignoreRejectedToken: true });
      reset = true;
    }
    applyServerState(response, { reset, expectedEpoch: previousEpoch });
  });
  initialization = pending.finally(() => { initialization = null; });
  return initialization;
}

export const refreshFromServer = initialize;

export async function snapshot(): Promise<FinanceSnapshot> {
  const state = getCachedState();
  return {
    accounts: state.accounts.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    categories: state.categories.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    entries: state.entries.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt)),
    settings: state.settings,
  };
}

/** Todos os comandos financeiros passam pelo Apps Script. */
export function runRemoteCommand<Result>(type: AcademicCommandType, payload: object): Promise<Result> {
  return serializeRemoteOperation(async () => {
    const previousEpoch = epoch;
    const response = await sendCommand<Result>(type, payload);
    applyServerState(response, { expectedEpoch: previousEpoch });
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
  return JSON.stringify({ application: 'compasso-academico', version: 2, exportedAt: new Date().toISOString(), ...getCachedState() }, null, 2);
}

export async function restoreBackup(raw: string): Promise<void> {
  if (typeof raw !== 'string' || raw.length > 2_000_000) throw new Error('Escolha uma cópia acadêmica de até 2 MB.');
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error('Não foi possível ler o arquivo JSON.'); }
  if (!value || typeof value !== 'object' || (value as { application?: unknown }).application !== 'compasso-academico'
      || (value as { version?: unknown }).version !== 2) {
    // Rejeita antes de chamar o Apps Script para não enviar uma cópia pessoal ao servidor acadêmico.
    throw new Error('Importe somente uma cópia da demonstração acadêmica. Cópias pessoais do Compasso não são enviadas a este servidor.');
  }
  await runRemoteCommand('restoreBackup', { raw });
}

async function restartDemo(): Promise<void> {
  await serializeRemoteOperation(async () => {
    const response = await createDemoSession();
    applyServerState(response, { reset: true });
  });
}

/** Nova sessão remota com dados sintéticos, sem importar o banco pessoal. */
export const seedExampleData = restartDemo;
export const resetExampleData = restartDemo;

export async function clearEntries(): Promise<void> {
  await runRemoteCommand('clearEntries', {});
}

export type { AcademicState };
