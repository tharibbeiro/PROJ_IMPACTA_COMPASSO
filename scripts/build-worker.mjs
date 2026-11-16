import { readFile, readdir, mkdir, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.zip':'application/zip','.pdf':'application/pdf','.md':'text/plain; charset=utf-8','.puml':'text/plain; charset=utf-8'};
const assets={};
async function collect(dir,prefix='') { for(const file of await readdir(dir,{withFileTypes:true})) { const relative=prefix+'/'+file.name; if(file.isDirectory()) await collect(path.join(dir,file.name),relative); else assets[relative]={type:mime[path.extname(file.name)]??'application/octet-stream',base64:(await readFile(path.join(dir,file.name))).toString('base64')}; } }
await collect('dist/client');
await mkdir('dist/server',{recursive:true});
await build({entryPoints:['backend/worker.ts'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'dist/server/index.js',minify:true,define:{__STATIC_ASSETS__:JSON.stringify(assets)}});
await cp('database/migrations','dist/server/migrations',{recursive:true});
await writeFile('dist/server/wrangler.json',JSON.stringify({name:'compasso-academico',main:'index.js',compatibility_date:'2026-11-01',d1_databases:[{binding:'DB',database_name:'compasso-academico',migrations_dir:'migrations'}]},null,2));
console.log(`Worker gerado com ${Object.keys(assets).length} arquivos estáticos e API integrada.`);
// O publicador Sites aplica migrações no formato Drizzle antes de ativar o Worker.
// Os arquivos SQL de origem permanecem em database/migrations; esta pasta é derivada.
await mkdir('drizzle/meta',{recursive:true});
const migrations=(await readdir('database/migrations')).filter(name=>name.endsWith('.sql')).sort();
const journal={version:'7',dialect:'sqlite',entries:[]};
for(let index=0;index<migrations.length;index++){
  const name=migrations[index];
  const sql=await readFile(path.join('database/migrations',name),'utf8');
  await writeFile(path.join('drizzle',name),sql.replace(/;\s*\n/g,';\n--> statement-breakpoint\n'));
  journal.entries.push({idx:index,version:'6',when:1794679200000+index*1000,tag:name.replace(/\.sql$/,''),breakpoints:true});
}
await writeFile('drizzle/meta/_journal.json',JSON.stringify(journal,null,2));
