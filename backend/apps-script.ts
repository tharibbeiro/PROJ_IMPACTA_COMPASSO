import { AppError, type DemoSession, type FinanceCommand } from './contracts';
import { FinanceService } from './services/finance-service';
import { createDemoState } from './services/demo-state';
import { AppsScriptSheetPort, type GoogleSpreadsheet } from './repositories/apps-script-sheet-port';
import { SHEET_HEADERS, SheetsFinanceRepository } from './repositories/sheets-finance-repository';

export const SPREADSHEET_PROPERTY = 'COMPASSO_SPREADSHEET_ID';
export const MAX_ACTIVE_SESSIONS = 50;

interface ScriptProperties {
  getProperty(key: string): string | null;
  setProperty(key: string, value: string): unknown;
}

interface ScriptLock {
  waitLock(milliseconds: number): void;
  releaseLock(): void;
}

/** Porta estreita para os serviços nativos. Os testes fornecem implementações em memória. */
export interface AppsScriptRuntime {
  SpreadsheetApp: { create(name: string): GoogleSpreadsheet; openById(id: string): GoogleSpreadsheet; flush(): void };
  PropertiesService: { getScriptProperties(): ScriptProperties };
  LockService: { getScriptLock(): ScriptLock };
  Utilities: {
    getUuid(): string;
    DigestAlgorithm: { SHA_256: unknown };
    Charset: { UTF_8: unknown };
    computeDigest(algorithm: unknown, input: string, charset: unknown): number[];
  };
}

function serializeError(error: unknown): string {
  return JSON.stringify(error instanceof AppError
    ? { error: error.message, status: error.status }
    : { error: 'Não foi possível concluir a operação no Google Sheets. Tente novamente.', status: 503 });
}

function canonical(value: unknown, depth = 0): string {
  if (depth > 30) throw new AppError('O comando possui uma estrutura muito profunda.', 400);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, depth + 1)).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key], depth + 1)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function parseCommand(raw: unknown): FinanceCommand {
  if (typeof raw !== 'string' || raw.length > 2_500_000) throw new AppError('O comando enviado é inválido ou muito grande.', 400);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new AppError('Não foi possível ler o comando enviado.', 400); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AppError('O comando enviado é inválido.', 400);
  const command = parsed as Record<string, unknown>;
  if (typeof command.id !== 'string' || !/^[a-zA-Z0-9_-]{12,100}$/.test(command.id)
      || typeof command.type !== 'string' || command.type.length > 40
      || !command.payload || typeof command.payload !== 'object' || Array.isArray(command.payload)) throw new AppError('O comando enviado é inválido.', 400);
  return { id: command.id, type: command.type, payload: command.payload as Record<string, unknown> };
}

export function createAppsScriptController(runtime: AppsScriptRuntime, clock: () => Date = () => new Date()) {
  const hash = (value: string) => runtime.Utilities.computeDigest(runtime.Utilities.DigestAlgorithm.SHA_256, value, runtime.Utilities.Charset.UTF_8)
    .map((byte) => ((byte + 256) % 256).toString(16).padStart(2, '0')).join('');

  const locked = (work: () => unknown): string => {
    let lock: ScriptLock | undefined;
    let acquired = false;
    let output: string;
    try {
      lock = runtime.LockService.getScriptLock();
      lock.waitLock(15000);
      acquired = true;
      output = JSON.stringify(work());
    } catch (error) {
      output = serializeError(error);
    } finally {
      if (acquired) {
        try { lock?.releaseLock(); } catch (error) { output = serializeError(error); }
      }
    }
    return output!;
  };

  const repository = () => {
    const spreadsheetId = runtime.PropertiesService.getScriptProperties().getProperty(SPREADSHEET_PROPERTY);
    if (!spreadsheetId) throw new AppError('A demonstração ainda não está configurada. Execute configurarCompasso_ no editor do Apps Script.', 503);
    const spreadsheet = runtime.SpreadsheetApp.openById(spreadsheetId);
    const port = new AppsScriptSheetPort(spreadsheet, () => runtime.SpreadsheetApp.flush());
    return { repository: new SheetsFinanceRepository(port, clock, () => runtime.Utilities.getUuid()), port };
  };

  const authenticate = (repo: SheetsFinanceRepository, token: unknown): DemoSession => {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new AppError('A sessão de demonstração é inválida ou expirou. Inicie uma nova demonstração.', 401);
    const session = repo.findSession(hash(token));
    if (!session || Date.parse(session.expiresAt) <= clock().getTime()) throw new AppError('A sessão de demonstração é inválida ou expirou. Inicie uma nova demonstração.', 401);
    return session;
  };

  const response = (state: unknown, revision: number, expiresAt: string, extra: Record<string, unknown> = {}) => ({
    state, revision, database: 'Google Sheets', mode: 'demo', sessionExpiresAt: expiresAt, ...extra,
  });

  return {
    configurar: (): string => locked(() => {
      const properties = runtime.PropertiesService.getScriptProperties();
      const existing = properties.getProperty(SPREADSHEET_PROPERTY);
      const spreadsheet = existing ? runtime.SpreadsheetApp.openById(existing) : runtime.SpreadsheetApp.create('Compasso — Demonstração');
      if (!existing) {
        properties.setProperty(SPREADSHEET_PROPERTY, spreadsheet.getId());
        const first = spreadsheet.getSheets()[0];
        if (first && !first.getLastRow()) first.setName('Contas');
      }
      const port = new AppsScriptSheetPort(spreadsheet, () => runtime.SpreadsheetApp.flush());
      for (const [name, headers] of Object.entries(SHEET_HEADERS)) port.ensureSheet(name, headers);
      port.flush();
      return { configured: true, spreadsheetUrl: spreadsheet.getUrl(), database: 'Google Sheets' };
    }),

    bootstrap: (token: string): string => locked(() => {
      const { repository: repo } = repository();
      const session = authenticate(repo, token);
      const loaded = repo.load(session.id);
      return response(loaded.state, loaded.revision, session.expiresAt);
    }),

    createDemoSession: (previousToken?: string): string => locked(() => {
      const { repository: repo, port } = repository();
      const previous = previousToken === undefined ? undefined : authenticate(repo, previousToken);
      repo.cleanupExpired();
      const active = port.read('Sessoes').slice(1).filter((row) => row[5] === 'active' && Date.parse(String(row[4])) > clock().getTime()).length;
      if (active - (previous ? 1 : 0) >= MAX_ACTIVE_SESSIONS) throw new AppError('A demonstração atingiu o limite de sessões ativas. Tente novamente mais tarde.', 429);
      const token = `${runtime.Utilities.getUuid()}${runtime.Utilities.getUuid()}`.replace(/-/g, '').toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(token)) throw new AppError('Não foi possível gerar uma sessão segura.', 503);
      const state = createDemoState(clock());
      const session = repo.createSession(hash(token), state);
      if (previous) repo.invalidateSession(previous.id);
      return response(state, session.revision, session.expiresAt, { sessionToken: token });
    }),

    command: (token: string, commandJson: string): string => locked(() => {
      const { repository: repo } = repository();
      const session = authenticate(repo, token);
      const command = parseCommand(commandJson);
      const fingerprint = hash(canonical({ type: command.type, payload: command.payload }));
      const replay = repo.findCommand(session.id, command.id);
      const loaded = repo.load(session.id);
      if (replay) {
        if (replay.fingerprint !== fingerprint) throw new AppError('Este identificador de comando já foi usado com outros dados.', 409);
        return response(loaded.state, loaded.revision, session.expiresAt, { result: replay.result ?? null });
      }
      const applied = new FinanceService(clock).apply(loaded.state, command);
      const result = applied.result ?? null;
      const committed = repo.commit(session.id, loaded.revision, command.id, loaded.state, applied.state, result, fingerprint);
      if (!committed.applied) throw new AppError('Os dados foram alterados. Atualize a demonstração e tente novamente.', 409);
      return response(applied.state, committed.revision, session.expiresAt, { result });
    }),
  };
}

declare const SpreadsheetApp: AppsScriptRuntime['SpreadsheetApp'];
declare const PropertiesService: AppsScriptRuntime['PropertiesService'];
declare const LockService: AppsScriptRuntime['LockService'];
declare const Utilities: AppsScriptRuntime['Utilities'];

function runtime(): AppsScriptRuntime {
  if (typeof SpreadsheetApp === 'undefined' || typeof PropertiesService === 'undefined' || typeof LockService === 'undefined' || typeof Utilities === 'undefined') throw new AppError('Este servidor deve ser executado no Google Apps Script.', 503);
  return { SpreadsheetApp, PropertiesService, LockService, Utilities };
}

function defaultCall(work: (controller: ReturnType<typeof createAppsScriptController>) => string): string {
  try { return work(createAppsScriptController(runtime())); } catch (error) { return serializeError(error); }
}

export function configurar(): string { return defaultCall((controller) => controller.configurar()); }
export function bootstrap(token: string): string { return defaultCall((controller) => controller.bootstrap(token)); }
export function createDemoSession(previousToken?: string): string { return defaultCall((controller) => controller.createDemoSession(previousToken)); }
export function command(token: string, commandJson: string): string { return defaultCall((controller) => controller.command(token, commandJson)); }
