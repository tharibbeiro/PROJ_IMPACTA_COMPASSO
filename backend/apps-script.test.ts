import { describe, expect, it } from 'vitest';
import { createAppsScriptController, SPREADSHEET_PROPERTY } from './apps-script';
import { runtimeFixture } from './repositories/google-sheets.fake';
import type { AcademicState } from './contracts';

interface Response { state?: AcademicState; sessionToken?: string; sessionExpiresAt?: string; revision?: number; status?: number; result?: unknown; error?: string; database?: string }
const decoded = (value: string) => JSON.parse(value) as Response;

function configured() {
  const fixture = runtimeFixture();
  const controller = createAppsScriptController(fixture.runtime, fixture.clock);
  expect(JSON.parse(controller.configurar()).configured).toBe(true);
  return { ...fixture, controller };
}

describe('controlador síncrono Apps Script', () => {
  it('configura uma planilha privada única pelo servidor, com oito abas estruturadas', () => {
    const fixture = configured();
    fixture.controller.configurar();
    expect(fixture.stats().created).toBe(1);
    expect(fixture.properties.get(SPREADSHEET_PROPERTY)).toBe(fixture.spreadsheet.getId());
    expect(fixture.spreadsheet.getSheets().map((sheet) => sheet.getName()).sort()).toEqual(['Contas', 'Categorias', 'Lancamentos', 'Planejamentos', 'RegistrosMensais', 'Preferencias', 'Sessoes', 'Comandos'].sort());
    expect(fixture.stats().locked).toBe(false);
  });

  it('segrega visitantes, persiste somente hash e protege todas as operações com lock', () => {
    const fixture = configured();
    const first = decoded(fixture.controller.createDemoSession());
    const second = decoded(fixture.controller.createDemoSession());
    expect(first.sessionToken).toMatch(/^[a-f0-9]{64}$/);
    expect(first.sessionToken).not.toBe(second.sessionToken);
    const command = { id: 'command-preferences-01', type: 'savePreferences', payload: { input: { displayName: 'Visitante A' } } };
    const changed = decoded(fixture.controller.command(first.sessionToken!, JSON.stringify(command)));
    expect(changed.state?.settings.displayName).toBe('Visitante A');
    expect(decoded(fixture.controller.bootstrap(second.sessionToken!)).state?.settings.displayName).toBe('Demonstração');
    expect(JSON.stringify(fixture.spreadsheet.getSheetByName('Sessoes')!.rows)).not.toContain(first.sessionToken);
    expect(changed.database).toBe('Google Sheets');
    expect(fixture.stats().lockCount).toBe(fixture.stats().releaseCount);
  });

  it('não reexecuta comando e rejeita mesmo ID com conteúdo diferente', () => {
    const { controller } = configured();
    const initial = decoded(controller.createDemoSession());
    const command = { id: 'command-create-account-01', type: 'addAccount', payload: { input: { name: 'Conta de teste', type: 'bank', openingBalanceCents: 0 } } };
    const first = decoded(controller.command(initial.sessionToken!, JSON.stringify(command)));
    const repeated = decoded(controller.command(initial.sessionToken!, JSON.stringify({ payload: { input: { openingBalanceCents: 0, type: 'bank', name: 'Conta de teste' } }, type: command.type, id: command.id })));
    expect(repeated.revision).toBe(first.revision);
    expect(repeated.state?.accounts).toEqual(first.state?.accounts);
    expect(repeated.result).toEqual(first.result);
    const conflict = decoded(controller.command(initial.sessionToken!, JSON.stringify({ ...command, payload: { input: { name: 'Outro nome', type: 'bank', openingBalanceCents: 0 } } })));
    expect(conflict.status).toBe(409);
  });

  it('nega token forjado, expiração e reinício com token anterior não autenticado', () => {
    const fixture = configured();
    const first = decoded(fixture.controller.createDemoSession());
    expect(decoded(fixture.controller.bootstrap('0'.repeat(64))).status).toBe(401);
    expect(decoded(fixture.controller.createDemoSession('0'.repeat(64))).status).toBe(401);
    expect(decoded(fixture.controller.bootstrap(first.sessionToken!)).state).toBeDefined();
    fixture.setNow(new Date(Date.parse(first.sessionExpiresAt!) + 1));
    expect(decoded(fixture.controller.bootstrap(first.sessionToken!)).status).toBe(401);
    expect(decoded(fixture.controller.createDemoSession()).sessionToken).toBeDefined();
  });

  it('aceita null como argumento ausente do transporte sem invalidar sessões existentes', () => {
    const { controller } = configured();
    const first = decoded(controller.createDemoSession());
    const fresh = decoded(controller.createDemoSession(null));
    expect(fresh.sessionToken).toMatch(/^[a-f0-9]{64}$/);
    expect(fresh.sessionToken).not.toBe(first.sessionToken);
    expect(decoded(controller.bootstrap(first.sessionToken!)).state).toBeDefined();
    expect(decoded(controller.bootstrap(fresh.sessionToken!)).state).toBeDefined();
    for (const invalid of ['', 0, false, {}]) {
      expect(decoded(controller.createDemoSession(invalid)).status).toBe(401);
    }
  });

  it('reinicia somente a própria sessão após gravar a nova com sucesso', () => {
    const fixture = configured();
    const first = decoded(fixture.controller.createDemoSession());
    const other = decoded(fixture.controller.createDemoSession());
    const replacement = decoded(fixture.controller.createDemoSession(first.sessionToken!));
    expect(replacement.sessionToken).not.toBe(first.sessionToken);
    expect(decoded(fixture.controller.bootstrap(first.sessionToken!)).status).toBe(401);
    expect(decoded(fixture.controller.bootstrap(other.sessionToken!)).state).toBeDefined();
    expect(decoded(fixture.controller.bootstrap(replacement.sessionToken!)).state).toBeDefined();
  });

  it('falha de staging não publica revisão nem responde sucesso', () => {
    const fixture = configured();
    const initial = decoded(fixture.controller.createDemoSession());
    const previousWrite = fixture.spreadsheet.beforeWrite;
    fixture.spreadsheet.beforeWrite = (write) => { previousWrite?.(write); if (write.sheet === 'Comandos' && write.row > 2) throw new Error('Falha simulada'); };
    const command = { id: 'command-stage-failure-01', type: 'savePreferences', payload: { input: { displayName: 'Não publicar' } } };
    expect(decoded(fixture.controller.command(initial.sessionToken!, JSON.stringify(command))).status).toBe(503);
    fixture.spreadsheet.beforeWrite = previousWrite;
    const read = decoded(fixture.controller.bootstrap(initial.sessionToken!));
    expect(read.revision).toBe(0);
    expect(read.state?.settings.displayName).toBe('Demonstração');
    const retried = decoded(fixture.controller.command(initial.sessionToken!, JSON.stringify(command)));
    expect(retried.revision).toBe(1);
  });

  it('rejeita falha de flush e payload inválido preservando estado ativo', () => {
    const fixture = configured();
    const initial = decoded(fixture.controller.createDemoSession());
    expect(decoded(fixture.controller.command(initial.sessionToken!, '{')).status).toBe(400);
    expect(decoded(fixture.controller.command(initial.sessionToken!, JSON.stringify({ id: 'command-unknown-01', type: 'notAllowed', payload: {} }))).status).toBe(400);
    fixture.failNextFlush();
    const command = { id: 'command-flush-failure-01', type: 'savePreferences', payload: { input: { displayName: 'Não publicar' } } };
    expect(decoded(fixture.controller.command(initial.sessionToken!, JSON.stringify(command))).status).toBe(503);
    expect(decoded(fixture.controller.bootstrap(initial.sessionToken!)).revision).toBe(0);
    expect(fixture.stats().locked).toBe(false);
  });
});
