import type { FinanceSnapshot } from '../domain/types';
import type { PlanningSnapshot } from '../domain/planning-types';

/** Contrato HTTP da demonstração. Nenhuma credencial da sessão fica em JavaScript. */
export interface AcademicState extends FinanceSnapshot, PlanningSnapshot {}

export interface StateEnvelope<Result = unknown> {
  state: AcademicState;
  revision: number;
  result?: Result;
  database?: string;
  mode?: 'demo';
}

export type AcademicCommandType =
  | 'saveEntry' | 'settleEntry' | 'deleteEntry'
  | 'addAccount' | 'updateAccount' | 'addCategory' | 'savePreferences'
  | 'restoreBackup' | 'clearEntries'
  | 'savePlan' | 'deletePlan' | 'realizePlan' | 'settlePlan'
  | 'setPlanningChecked' | 'linkPlanEntry';

export class ApiRequestError extends Error {
  constructor(message: string, readonly kind: 'network' | 'http' | 'invalid-response', readonly status?: number) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

let requestQueue: Promise<unknown> = Promise.resolve();

/** Serializa requisições, sem guardar alterações locais ou reenviá-las offline. */
export function serializeRemoteOperation<T>(operation: () => Promise<T>): Promise<T> {
  const execute = () => {
    // Web Locks também evita que duas abas substituam o cache fora de ordem.
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      return navigator.locks.request('compasso-academico-api', operation);
    }
    return operation();
  };
  const queued = requestQueue.then(execute, execute);
  requestQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

function validEnvelope(value: unknown): value is StateEnvelope {
  if (!value || typeof value !== 'object') return false;
  const body = value as Partial<StateEnvelope>;
  const state = body.state;
  return Number.isSafeInteger(body.revision) && Number(body.revision) >= 0
    && Boolean(state && Array.isArray(state.accounts) && Array.isArray(state.categories)
      && Array.isArray(state.entries) && Array.isArray(state.plans) && Array.isArray(state.occurrences)
      && state.settings?.id === 'preferences' && typeof state.settings.displayName === 'string'
      && typeof state.settings.exampleMode === 'boolean');
}

async function requestState<Result>(path: '/api/bootstrap' | '/api/demo-sessions' | '/api/commands', body?: object): Promise<StateEnvelope<Result>> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiRequestError('Conecte-se à internet para consultar o servidor ou salvar alterações. Os dados já carregados continuam disponíveis para leitura.', 'network');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    let value: unknown;
    try { value = await response.json(); }
    catch { throw new ApiRequestError('O servidor não retornou uma resposta válida. Verifique se a API da demonstração está disponível.', 'invalid-response', response.status); }
    if (!response.ok) {
      const serverError = value && typeof value === 'object' ? (value as { error?: unknown }).error : undefined;
      const message = typeof serverError === 'string' ? serverError : response.status === 401
        ? 'A sessão de demonstração expirou. Atualize a página para iniciar uma nova sessão.'
        : 'O servidor não conseguiu concluir a operação. Tente novamente.';
      throw new ApiRequestError(message, 'http', response.status);
    }
    if (!validEnvelope(value)) {
      throw new ApiRequestError('A resposta recebida está incompleta. Nenhum dado local foi alterado.', 'invalid-response', response.status);
    }
    return value as StateEnvelope<Result>;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    throw new ApiRequestError('Não foi possível confirmar a operação no servidor. Conecte-se à internet e tente novamente; nenhuma alteração foi aplicada ao cache local.', 'network');
  } finally {
    clearTimeout(timeout);
  }
}

export function fetchBootstrap(): Promise<StateEnvelope> {
  return requestState('/api/bootstrap');
}

export function createDemoSession(): Promise<StateEnvelope> {
  // O servidor gera os exemplos. Esta requisição não envia o cache do aparelho.
  return requestState('/api/demo-sessions', {});
}

const uncertainCommandIds = new Map<string, string>();

export async function sendCommand<Result>(type: AcademicCommandType, payload: object): Promise<StateEnvelope<Result>> {
  const signature = JSON.stringify({ type, payload });
  // Se a conexão cair após a gravação, uma repetição manual usa a mesma chave.
  // Isso é somente memória da aba; não é fila de alterações offline.
  const id = uncertainCommandIds.get(signature) ?? crypto.randomUUID();
  uncertainCommandIds.set(signature, id);
  try {
    const response = await requestState<Result>('/api/commands', { id, type, payload });
    uncertainCommandIds.delete(signature);
    return response;
  } catch (error) {
    if (error instanceof ApiRequestError && error.kind !== 'network') uncertainCommandIds.delete(signature);
    throw error;
  }
}
