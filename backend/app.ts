import { Hono, type Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { AppError } from './contracts';
import type { DemoSession, FinanceCommand } from './contracts';
import type { D1Like } from './repositories/d1-types';
import { D1FinanceRepository } from './repositories/d1-finance-repository';
import { FinanceService } from './services/finance-service';
import { createDemoState } from './services/demo-state';

export interface AppBindings { DB: D1Like }
const COOKIE = 'compasso_academic_demo';
const MAX_BODY_BYTES = 1_500_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Rotas HTTP: a API nunca confia no identificador de sessão enviado pelo cliente. */
export function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();
  const service = new FinanceService();
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    if (!c.env?.DB) throw new AppError('O banco de dados da demonstração não está configurado.', 503);
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const origin = c.req.header('origin');
      if ((origin && origin !== new URL(c.req.url).origin) || c.req.header('sec-fetch-site') === 'cross-site') {
        throw new AppError('A origem da requisição não foi autorizada.', 403);
      }
      if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) {
        throw new AppError('Envie os dados no formato JSON.', 415);
      }
      const declared = Number(c.req.header('content-length') ?? 0);
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new AppError('A requisição ultrapassa o limite da demonstração.', 413);
    }
    await next();
  });
  async function session(c: Context<{ Bindings: AppBindings }>): Promise<DemoSession> {
    const cookie = getCookie(c, COOKIE);
    if (!cookie || !/^[0-9a-f-]{36}\.[0-9a-f-]{36}$/i.test(cookie)) throw new AppError('Inicie uma sessão de demonstração para continuar.', 401);
    const found = await new D1FinanceRepository(c.env.DB).findSession(await digest(cookie));
    if (!found) throw new AppError('A sessão de demonstração expirou. Atualize a página para iniciar outra.', 401);
    return found;
  }
  app.get('/api/health', async (c) => {
    await c.env.DB.prepare('SELECT COUNT(*) AS total FROM demo_sessions').first();
    return c.json({ status: 'ok', application: 'compasso-academico', layers: ['front-end React', 'back-end TypeScript', 'banco SQL'], database: 'SQLite / Cloudflare D1' });
  });
  app.post('/api/demo-sessions', async (c) => {
    const repo = new D1FinanceRepository(c.env.DB);
    await repo.cleanupExpired();
    const count = await c.env.DB.prepare('SELECT COUNT(*) AS total FROM demo_sessions').first<{ total: number }>();
    if ((count?.total ?? 0) >= 1000) throw new AppError('A demonstração atingiu o limite temporário de sessões. Tente novamente mais tarde.', 429);
    const token = `${crypto.randomUUID()}.${crypto.randomUUID()}`;
    const state = createDemoState(new Date());
    const created = await repo.createSession(await digest(token), state);
    setCookie(c, COOKIE, token, { httpOnly: true, secure: new URL(c.req.url).protocol === 'https:', sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 14 });
    return c.json({ state, revision: created.revision, database: 'Cloudflare D1 / SQLite', mode: 'demo' }, 201);
  });
  app.get('/api/bootstrap', async (c) => {
    const active = await session(c);
    const loaded = await new D1FinanceRepository(c.env.DB).load(active.id);
    return c.json({ ...loaded, database: 'Cloudflare D1 / SQLite', mode: 'demo' });
  });
  app.post('/api/commands', async (c) => {
    const active = await session(c);
    const raw = await c.req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new AppError('A requisição ultrapassa o limite da demonstração.', 413);
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new AppError('O corpo da requisição não é um JSON válido.'); }
    if (!value || typeof value !== 'object') throw new AppError('Informe um comando válido.');
    const command = value as FinanceCommand;
    if (!UUID.test(command.id) || typeof command.type !== 'string' || !command.payload || typeof command.payload !== 'object' || Array.isArray(command.payload)) throw new AppError('O comando está incompleto ou possui um identificador inválido.');
    const repo = new D1FinanceRepository(c.env.DB);
    const prior = await repo.findCommand(active.id, command.id);
    if (prior) return c.json({ ...await repo.load(active.id), result: prior.result });
    const before = await repo.load(active.id);
    const changes = service.apply(before.state, command);
    const result = changes.result ?? null;
    const committed = await repo.commit(active.id, before.revision, command.id, before.state, changes.state, result);
    if (!committed.applied) {
      const repeated = await repo.findCommand(active.id, command.id);
      if (repeated) return c.json({ ...await repo.load(active.id), result: repeated.result });
      throw new AppError('Os dados foram alterados em outra aba. Atualize a página e tente novamente.', 409);
    }
    return c.json({ ...await repo.load(active.id), result });
  });
  app.notFound((c) => c.json({ error: 'Rota da API não encontrada.' }, 404));
  app.onError((error, c) => {
    if (error instanceof AppError) return c.json({ error: error.message }, error.status as 400);
    console.error('Falha interna da API acadêmica:', error instanceof Error ? error.message : 'erro desconhecido');
    return c.json({ error: 'O servidor não conseguiu concluir a operação. Tente novamente.' }, 500);
  });
  return app;
}
