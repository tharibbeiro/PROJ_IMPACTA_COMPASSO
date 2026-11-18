import type { FinanceSnapshot } from '../domain/types';
import type { PlanningSnapshot } from '../domain/planning-types';

/** Dados do servidor. O navegador não grava informações financeiras por conta própria. */
export interface AcademicState extends FinanceSnapshot, PlanningSnapshot {}

export interface StateEnvelope<Result = unknown> {
  state: AcademicState;
  revision: number;
  result?: Result;
  database?: 'Google Sheets';
  mode?: 'demo';
  sessionToken?: string;
  sessionExpiresAt?: string;
}

export type AcademicCommandType =
  | 'saveEntry' | 'settleEntry' | 'deleteEntry'
  | 'addAccount' | 'updateAccount' | 'addCategory' | 'savePreferences'
  | 'restoreBackup' | 'clearEntries'
  | 'savePlan' | 'deletePlan' | 'realizePlan' | 'settlePlan'
  | 'setPlanningChecked' | 'linkPlanEntry';

type RpcMethod = 'compassoBootstrap' | 'compassoCreateDemoSession' | 'compassoCommand';
interface ScriptRunner {
  withSuccessHandler(callback: (value: unknown) => void): ScriptRunner;
  withFailureHandler(callback: (error: unknown) => void): ScriptRunner;
  compassoBootstrap(token: string): void;
  compassoCreateDemoSession(previousToken?: string): void;
  compassoCommand(token: string, commandJson: string): void;
}
interface GoogleRuntime { script?: { run?: ScriptRunner } }
interface StoredSession { token: string; expiresAt?: string }

export class ApiRequestError extends Error {
  constructor(message: string, readonly kind: 'network' | 'server' | 'invalid-response' | 'unavailable', readonly status?: number) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

const SESSION_KEY = 'compasso-google-session-v1';
let session: StoredSession | null = null;
let storageRead = false;
let persistent = false;
let requestQueue: Promise<unknown> = Promise.resolve();

function storage(): Storage | undefined {
  try { return globalThis.localStorage; }
  catch { return undefined; }
}

function validToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16 && value.length <= 2048 && !/[\r\n]/.test(value);
}

function readSession(): StoredSession | null {
  if (storageRead) return session;
  storageRead = true;
  try {
    const source = storage();
    if (!source) return null;
    const raw = source.getItem(SESSION_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === 'object' && validToken((value as StoredSession).token)) {
      const found = value as StoredSession;
      session = { token: found.token, ...(typeof found.expiresAt === 'string' ? { expiresAt: found.expiresAt } : {}) };
      persistent = true;
    }
  } catch {
    // O sandbox do HtmlService pode impedir acesso ao armazenamento do navegador.
    persistent = false;
  }
  // A validade da sessão é sempre conferida pelo servidor, inclusive seu prazo.
  return session;
}

function rememberSession(value: StateEnvelope): void {
  if (!validToken(value.sessionToken) || typeof value.sessionExpiresAt !== 'string' || !Number.isFinite(Date.parse(value.sessionExpiresAt))) {
    throw new ApiRequestError('O Apps Script não retornou uma sessão válida. Nenhum dado de exemplo foi criado no navegador.', 'invalid-response');
  }
  session = { token: value.sessionToken, expiresAt: value.sessionExpiresAt };
  storageRead = true;
  persistent = false;
  try {
    const target = storage();
    if (target) {
      target.setItem(SESSION_KEY, JSON.stringify(session));
      persistent = true;
    }
  } catch {
    // O token permanece apenas em memória; a interface informa essa limitação.
  }
}

/** Retorna somente informações para a interface; nunca expõe o token em links ou avisos. */
export function getSessionInfo(): { persistent: boolean; expiresAt?: string } {
  readSession();
  return { persistent, ...(session?.expiresAt ? { expiresAt: session.expiresAt } : {}) };
}

export function serializeRemoteOperation<T>(operation: () => Promise<T>): Promise<T> {
  const pending = requestQueue.then(operation, operation);
  requestQueue = pending.then(() => undefined, () => undefined);
  return pending;
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

function decodeResponse<Result>(raw: unknown): StateEnvelope<Result> {
  if (typeof raw !== 'string') throw new ApiRequestError('O Apps Script retornou uma resposta inválida.', 'invalid-response');
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new ApiRequestError('Não foi possível ler a resposta do Apps Script.', 'invalid-response'); }
  if (value && typeof value === 'object' && typeof (value as { error?: unknown }).error === 'string') {
    const error = value as { error: string; status?: unknown };
    throw new ApiRequestError(error.error, 'server', Number.isInteger(error.status) ? Number(error.status) : 400);
  }
  if (!validEnvelope(value)) throw new ApiRequestError('A resposta do Apps Script está incompleta. Os dados exibidos foram preservados.', 'invalid-response');
  return value as StateEnvelope<Result>;
}

function requestState<Result>(method: RpcMethod, args: string[]): Promise<StateEnvelope<Result>> {
  const runtime = (globalThis as typeof globalThis & { google?: GoogleRuntime }).google;
  const bridge = runtime?.script?.run;
  if (!bridge) {
    return Promise.reject(new ApiRequestError('Abra o Compasso pelo endereço de implantação do Google Apps Script. Esta página precisa desse ambiente para carregar e salvar os dados.', 'unavailable'));
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return Promise.reject(new ApiRequestError('Conecte-se à internet para carregar ou salvar os dados no Google Sheets.', 'network'));
  }
  return new Promise((resolve, reject) => {
    let finished = false;
    const fail = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      const message = method === 'compassoCommand'
        ? 'Ainda não foi possível confirmar a gravação. Ela pode ter sido concluída. Verifique a conexão e tente salvar novamente neste formulário para confirmar a operação.'
        : 'Não foi possível carregar os dados do Apps Script. Verifique a conexão e tente novamente.';
      reject(new ApiRequestError(message, 'network'));
    };
    // Gravações podem aguardar o bloqueio e uma resposta mais lenta do Google.
    // A chave do comando é mantida se a confirmação não chegar dentro do prazo.
    const timeout = setTimeout(fail, method === 'compassoBootstrap' ? 45_000 : 90_000);
    const onSuccess = (raw: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      try { resolve(decodeResponse<Result>(raw)); }
      catch (error) { reject(error); }
    };
    try {
      const runner = bridge.withSuccessHandler(onSuccess).withFailureHandler(fail);
      if (method === 'compassoBootstrap') runner.compassoBootstrap(args[0]);
      else if (method === 'compassoCreateDemoSession') {
        // Um argumento undefined pode virar null no transporte do Google.
        if (args.length) runner.compassoCreateDemoSession(args[0]);
        else runner.compassoCreateDemoSession();
      }
      else runner.compassoCommand(args[0], args[1]);
    } catch { fail(); }
  });
}

export function fetchBootstrap(): Promise<StateEnvelope> {
  return requestState('compassoBootstrap', [readSession()?.token ?? '']);
}

export async function createDemoSession(options: { ignoreRejectedToken?: boolean } = {}): Promise<StateEnvelope> {
  const previous = options.ignoreRejectedToken ? undefined : readSession()?.token;
  const response = await requestState('compassoCreateDemoSession', previous ? [previous] : []);
  // Mantém o token anterior até que a nova sessão seja confirmada pelo servidor.
  rememberSession(response);
  uncertainCommandIds.clear();
  return response;
}

const uncertainCommandIds = new Map<string, string>();

export async function sendCommand<Result>(type: AcademicCommandType, payload: object): Promise<StateEnvelope<Result>> {
  const token = readSession()?.token;
  if (!token) throw new ApiRequestError('A sessão de demonstração não está disponível. Reabra o aplicativo no Apps Script para continuar.', 'server', 401);
  const signature = JSON.stringify({ type, payload });
  // Uma repetição manual após falha usa o mesmo identificador; não há fila offline.
  const id = uncertainCommandIds.get(signature) ?? crypto.randomUUID();
  uncertainCommandIds.set(signature, id);
  try {
    const response = await requestState<Result>('compassoCommand', [token, JSON.stringify({ id, type, payload })]);
    uncertainCommandIds.delete(signature);
    return response;
  } catch (error) {
    // Uma resposta ilegível também pode ocorrer depois de a operação ser salva.
    // Somente uma rejeição explícita do servidor permite descartar a chave.
    if (error instanceof ApiRequestError && error.kind === 'server' && (error.status ?? 500) < 500) uncertainCommandIds.delete(signature);
    throw error;
  }
}
