import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app';
import { NodeSqliteDatabase } from './repositories/node-sqlite';

let db: NodeSqliteDatabase;
const app = createApp();
const origin = 'https://compasso.test';
const migration = readFileSync('database/migrations/0001_initial.sql','utf8');
beforeEach(() => { db = new NodeSqliteDatabase(); db.exec(migration); });
afterEach(() => db.close());
const request = (path:string,init:RequestInit={}) => app.fetch(new Request(origin+path,init),{DB:db});
async function start() {
  const response=await request('/api/demo-sessions',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:'{}'});
  expect(response.status).toBe(201);
  const cookie=response.headers.get('set-cookie')!;
  expect(cookie).toMatch(/HttpOnly/i);expect(cookie).toMatch(/SameSite=Lax/i);expect(cookie).toMatch(/Secure/i);
  return {cookie:cookie.split(';')[0],body:await response.json()};
}
const command=(cookie:string,type:string,payload:Record<string,unknown>,id=crypto.randomUUID(),extraHeaders:Record<string,string>={}) => request('/api/commands',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,Origin:origin,...extraHeaders},body:JSON.stringify({id,type,payload})});

describe('API, serviço e SQL funcionando em conjunto',()=>{
  it('verifica o banco e exige sessão antes de ler dados',async()=>{
    const health=await request('/api/health');expect(health.status).toBe(200);
    expect((await health.json()).database).toContain('SQLite');
    expect((await request('/api/bootstrap')).status).toBe(401);
    const {cookie}=await start();const bootstrap=await request('/api/bootstrap',{headers:{Cookie:cookie}});
    expect(bootstrap.status).toBe(200);expect((await bootstrap.json()).state.accounts.length).toBeGreaterThan(0);
  });
  it('grava pelo serviço, persiste no SQL e não mistura visitantes',async()=>{
    const a=await start();const b=await start();
    const response=await command(a.cookie,'addAccount',{input:{name:'Conta criada pela API',type:'bank',openingBalanceCents:12345}});
    expect(response.status).toBe(200);const body=await response.json();
    expect(body.state.accounts.some((a:{name:string})=>a.name==='Conta criada pela API')).toBe(true);
    const sql=await db.prepare('SELECT COUNT(*) AS total FROM accounts WHERE name=?').bind('Conta criada pela API').first<{total:number}>();expect(sql?.total).toBe(1);
    const other=await request('/api/bootstrap',{headers:{Cookie:b.cookie}});expect((await other.json()).state.accounts.some((a:{name:string})=>a.name==='Conta criada pela API')).toBe(false);
  });
  it('repetir um comando não duplica o registro e respostas são consistentes',async()=>{
    const {cookie}=await start();const id=crypto.randomUUID();const payload={input:{name:'Uma única conta',type:'cash',openingBalanceCents:0}};
    const first=await command(cookie,'addAccount',payload,id);const repeat=await command(cookie,'addAccount',payload,id);
    expect(first.status).toBe(200);expect(repeat.status).toBe(200);expect(await repeat.json()).toEqual(await first.json());
    const rows=await db.prepare('SELECT COUNT(*) AS total FROM accounts WHERE name=?').bind('Uma única conta').first<{total:number}>();expect(rows?.total).toBe(1);
  });
  it('recusa origem externa, comandos desconhecidos e valores inválidos sem alterar a revisão',async()=>{
    const {cookie,body}=await start();
    expect((await command(cookie,'addAccount',{input:{name:'Inválida',type:'bank',openingBalanceCents:0}},crypto.randomUUID(),{Origin:'https://outro.test'})).status).toBe(403);
    expect((await command(cookie,'executarSQL',{sql:'DROP TABLE accounts'})).status).toBe(400);
    expect((await command(cookie,'addAccount',{input:{name:'',type:'bank',openingBalanceCents:0}})).status).toBe(400);
    const current=await request('/api/bootstrap',{headers:{Cookie:cookie}});expect((await current.json()).revision).toBe(body.revision);
  });
  it('um erro de versão não sobrescreve o lançamento já editado',async()=>{
    const {cookie,body}=await start();const entry=body.state.entries[0];
    const first=await command(cookie,'saveEntry',{input:{...entry,description:'Edição confirmada'},id:entry.id,expectedVersion:entry.version});expect(first.status).toBe(200);
    const stale=await command(cookie,'saveEntry',{input:{...entry,description:'Edição antiga'},id:entry.id,expectedVersion:entry.version});expect(stale.status).toBe(409);
    const current=await request('/api/bootstrap',{headers:{Cookie:cookie}});expect((await current.json()).state.entries.find((e:{id:string})=>e.id===entry.id).description).toBe('Edição confirmada');
  });
  it('dados sobrevivem ao fechamento e à reabertura da conexão SQLite',async()=>{
    const folder=mkdtempSync(join(tmpdir(),'compasso-academico-'));const file=join(folder,'prova.sqlite');
    db.close();db=new NodeSqliteDatabase(file);db.exec(migration);
    try{
      const {cookie}=await start();expect((await command(cookie,'addAccount',{input:{name:'Persistida no disco',type:'bank',openingBalanceCents:8900}})).status).toBe(200);
      db.close();db=new NodeSqliteDatabase(file);
      const after=await request('/api/bootstrap',{headers:{Cookie:cookie}});expect((await after.json()).state.accounts.some((a:{name:string})=>a.name==='Persistida no disco')).toBe(true);
    }finally{db.close();db=new NodeSqliteDatabase();rmSync(folder,{recursive:true,force:true});}
  });
});
