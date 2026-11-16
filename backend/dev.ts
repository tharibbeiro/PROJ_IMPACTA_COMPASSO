import { createServer } from 'node:http';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { createApp } from './app';
import { NodeSqliteDatabase } from './repositories/node-sqlite';

await mkdir('.local', { recursive: true });
const database = new NodeSqliteDatabase(resolve('.local/compasso.sqlite'));
database.exec('CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY)');
for (const name of (await readdir('database/migrations')).filter((name) => name.endsWith('.sql')).sort()) {
  const existing = await database.prepare('SELECT name FROM _local_migrations WHERE name=?').bind(name).first();
  if (!existing) {
    database.exec(await readFile(resolve('database/migrations', name), 'utf8'));
    await database.prepare('INSERT INTO _local_migrations(name) VALUES (?)').bind(name).run();
  }
}
const app = createApp();
const listener = getRequestListener((request) => app.fetch(request, { DB: database }));
const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
let vite: Awaited<ReturnType<typeof import('vite')['createServer']>> | undefined;
const mime: Record<string,string> = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.zip':'application/zip','.pdf':'application/pdf' };
const server = createServer((request, response) => {
  if ((request.url ?? '').startsWith('/api/')) return void listener(request, response);
  if (vite) return void vite.middlewares(request, response);
  if (!production) { response.writeHead(503); response.end('Inicializando interface…'); return; }
  void (async () => {
    const root = resolve('dist/client');
    const url = new URL(request.url ?? '/', 'http://localhost');
    let path = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (path !== root && !path.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
    if (url.pathname.endsWith('/')) path = resolve(path, 'index.html');
    let content: Buffer;
    try { content = await readFile(path); }
    catch { if (extname(url.pathname)) { response.writeHead(404); response.end('Arquivo não encontrado.'); return; } path = resolve(root,'index.html'); content = await readFile(path); }
    response.writeHead(200,{ 'Content-Type':mime[extname(path)] ?? 'application/octet-stream','Cache-Control':'no-cache' });
    response.end(content);
  })().catch(() => { response.writeHead(500); response.end('Não foi possível servir a interface. Execute npm run build.'); });
});
if (!production) {
  const { createServer: createViteServer } = await import('vite');
  vite = await createViteServer({ configFile: resolve('vite.config.ts'), server:{ middlewareMode:true, hmr:{server} },appType:'spa' });
}
const port = Number(process.env.PORT ?? 3000);
server.listen(port,'127.0.0.1',() => console.log(`Compasso Acadêmico: http://127.0.0.1:${port} — API e banco SQL ativos.`));
async function shutdown() { await vite?.close(); server.close(); database.close(); }
process.on('SIGINT',() => { void shutdown(); }); process.on('SIGTERM',() => { void shutdown(); });
