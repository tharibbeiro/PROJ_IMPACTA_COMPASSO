import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Script, createContext } from 'node:vm';

const directory = 'apps-script';
await mkdir(directory, { recursive: true });

// O Google executa JavaScript V8, sem módulos Node ou APIs do navegador.
const server = await build({
  entryPoints: ['backend/apps-script.ts'],
  bundle: true, write: false, format: 'iife', globalName: 'CompassoBackend_',
  platform: 'neutral', target: 'es2018', charset: 'utf8', minify: false,
  define: { 'crypto.randomUUID': 'generateId_', structuredClone: 'cloneValue_' },
  banner: { js: `// Gerado a partir de backend/ e shared/. Edite as fontes e execute npm run build.
function generateId_() { return Utilities.getUuid(); }
function cloneValue_(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }` },
});
const wrappers = `
// A configuração termina em _ para não poder ser chamada pelo navegador.
function configurarCompasso_() { return CompassoBackend_.configurar(); }

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Compasso — Controle financeiro')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function compassoBootstrap(token) { return CompassoBackend_.bootstrap(token); }
function compassoCreateDemoSession(previousToken) { return CompassoBackend_.createDemoSession(previousToken); }
function compassoCommand(token, commandJson) { return CompassoBackend_.command(token, commandJson); }
`;
const code = server.outputFiles[0].text + wrappers;
// O editor do Apps Script recusa literais BigInt mesmo com runtime V8.
if (/\bBigInt\s*\(|\b(?:\d[\d_]*|0[xX][\da-fA-F]+)n\b/.test(code)) {
  throw new Error('O servidor contém uma operação numérica incompatível com o Apps Script.');
}
const context = createContext({});
new Script(code, { filename: 'Code.gs' }).runInContext(context);
for (const name of ['configurarCompasso_', 'doGet', 'compassoBootstrap', 'compassoCreateDemoSession', 'compassoCommand']) {
  if (typeof context[name] !== 'function') throw new Error(`Função ausente no Apps Script: ${name}`);
}
await writeFile(`${directory}/Code.gs`, code);

const browser = await build({
  entryPoints: ['frontend/src/main.tsx'], outfile: 'app.js',
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020',
  charset: 'utf8', minify: true, legalComments: 'eof',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const javascript = browser.outputFiles.find((file) => file.path.endsWith('.js'))?.text;
const css = browser.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
if (!javascript) throw new Error('A interface não foi compilada.');
const template = await readFile('frontend/index.html', 'utf8');
for (const marker of ['<!-- APP_STYLES -->', '<!-- APP_SCRIPT -->']) {
  if (!template.includes(marker)) throw new Error(`Marcador ausente no HTML: ${marker}`);
}
// Conteúdo compilado é inserido em contexto HTML, sem encerrar tags antecipadamente.
const html = template
  .replace('<!-- APP_STYLES -->', () => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`)
  .replace('<!-- APP_SCRIPT -->', () => `<script>${javascript.replace(/<\/script/gi, '<\\/script')}</script>`);
if (/<script\b[^>]*\bsrc\s*=/i.test(html) || /virtual:pwa-register|registerSW\(/.test(javascript)) {
  throw new Error('A interface precisa ser independente de arquivos externos e de service worker.');
}
await writeFile(`${directory}/Index.html`, html);
await writeFile(`${directory}/appsscript.json`, JSON.stringify({
  timeZone: 'America/Sao_Paulo',
  dependencies: {},
  exceptionLogging: 'STACKDRIVER',
  runtimeVersion: 'V8',
  oauthScopes: ['https://www.googleapis.com/auth/spreadsheets'],
  webapp: { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' },
}, null, 2) + '\n');
console.log(`Apps Script gerado: Code.gs (${Math.round(Buffer.byteLength(code) / 1024)} KB), Index.html (${Math.round(Buffer.byteLength(html) / 1024)} KB) e appsscript.json.`);
console.log('Os três arquivos podem ser copiados para o editor do Google Apps Script.');
