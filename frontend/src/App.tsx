import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import PlanningPage from './components/PlanningPage';
import type { PlanningSnapshot } from './domain/planning-types';
import { monthlyPlanningSummary } from './domain/planning';
import { getPlanningSnapshot } from './data/planning-repository';
import {
  ArrowDownLeft, ArrowUpRight, ArrowRight, Banknote, CalendarDays,
  Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock3,
  Compass, Download, FolderHeart, HardDrive, Info, Landmark, LayoutDashboard,
  Pencil, PieChart, Plus, ReceiptText, Search, Settings, ShieldCheck,
  Trash2, Upload, Wallet, WifiOff, X,
} from 'lucide-react';
import type { Account, Category, Entry, EntryInput, FinanceSnapshot } from './domain/types';
import { accountBalance, entriesForPeriod, formatMoney, localDate, monthSummary, parseMoney } from './domain/finance';
import {
  addAccount, addCategory, updateAccount, resetExampleData, deleteEntry, exportBackup, initialize,
  restoreBackup, saveEntry, savePreferences, seedExampleData, settleEntry, snapshot,
  subscribeState,
} from './data/repository';
import { getSessionInfo } from './data/api-client';

type Page = 'dashboard' | 'planning' | 'entries' | 'accounts' | 'history' | 'settings';
type Notice = { message: string; error?: boolean };
const navigation: { id: Page; label: string; icon: typeof Wallet }[] = [
  { id: 'dashboard', label: 'Visão geral', icon: LayoutDashboard },
  { id: 'planning', label: 'Planejamento', icon: CalendarDays },
  { id: 'entries', label: 'Lançamentos', icon: ReceiptText },
  { id: 'accounts', label: 'Contas e saldos', icon: Wallet },
  { id: 'history', label: 'Histórico', icon: PieChart },
];
const monthName = (month: string, short = false) => new Date(`${month}-15T12:00:00`).toLocaleDateString('pt-BR', { month: short ? 'short' : 'long', ...(short ? {} : { year: 'numeric' }) });
const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
const inputMoney = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível concluir. Tente novamente.';
const changeMonth = (month: string, offset: number) => {
  const date = new Date(`${month}-15T12:00:00`);
  date.setMonth(date.getMonth() + offset);
  return localDate(date).slice(0, 7);
};

function downloadFile(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);
  return <dialog ref={dialog} className={`modal ${wide ? 'modal-wide' : ''}`} aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === dialog.current) onClose(); }}>
    <div className="modal-header"><div><span className="eyebrow">COMPASSO</span><h2 id="dialog-title">{title}</h2></div><button className="icon-button" aria-label="Fechar janela" onClick={onClose}><X size={20} /></button></div>
    {children}
  </dialog>;
}

function EntryForm({ entry, accounts, categories, onClose, onSaved }: { entry?: Entry; accounts: Account[]; categories: Category[]; onClose: () => void; onSaved: (entry: Entry) => void }) {
  const [kind, setKind] = useState<Entry['kind']>(entry?.kind ?? 'expense');
  const [description, setDescription] = useState(entry?.description ?? '');
  const [amount, setAmount] = useState(entry ? inputMoney(entry.amountCents) : '');
  const [categoryId, setCategoryId] = useState(entry?.categoryId ?? categories.find((c) => c.kind === 'expense')?.id ?? '');
  const [accountId, setAccountId] = useState(entry?.accountId ?? accounts[0]?.id ?? '');
  const [occurredOn, setOccurredOn] = useState(entry?.occurredOn ?? localDate());
  const [dueOn, setDueOn] = useState(entry?.dueOn ?? localDate());
  const [status, setStatus] = useState<Entry['status']>(entry?.status ?? 'pending');
  const [paidOn, setPaidOn] = useState(entry?.paidOn ?? localDate());
  const [isCardPayment, setIsCardPayment] = useState(entry?.isCardPayment ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError('');
    try {
      const input: EntryInput = { description, kind, amountCents: parseMoney(amount), categoryId, accountId, occurredOn, dueOn, status, isCardPayment: kind === 'expense' && !entry?.planId && isCardPayment, ...(status === 'paid' ? { paidOn } : {}) };
      const saved = await saveEntry(input, entry?.id, entry?.version);
      onSaved(saved);
    } catch (e) { setError(errorText(e)); setSaving(false); }
  }
  return <form onSubmit={submit} className="form">
    <div className="segmented" aria-label="Tipo de lançamento">{(['expense', 'income'] as const).map((value) => <button key={value} type="button" className={kind === value ? 'selected' : ''} aria-pressed={kind === value} onClick={() => { setKind(value); setCategoryId(categories.find((c) => c.kind === value)?.id ?? ''); }}>{value === 'expense' ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />}{value === 'expense' ? 'Despesa' : 'Receita'}</button>)}</div>
    <label className="amount-label">Valor em reais<div className="amount-input"><span>R$</span><input autoFocus required inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Valor em reais" /></div></label>
    <label>Descrição<input required maxLength={150} placeholder={kind === 'expense' ? 'Ex.: compra no mercado' : 'Ex.: salário'} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
    <div className="form-grid"><label>Categoria<select required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>{categories.filter((c) => c.kind === kind).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Conta<select required value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label></div>
    <div className="form-grid"><label>Data do lançamento<input required type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} /></label><label>Vencimento<input required type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></label></div>
    {kind === 'expense' && !entry?.planId && <div className="card-payment-field"><label className="checkbox-row"><input type="checkbox" checked={isCardPayment} onChange={(event) => setIsCardPayment(event.target.checked)} /><span>Pagamento de fatura já previsto no Planejamento</span></label>{isCardPayment && <p>Use quando todo este valor já estiver coberto pelos itens do cartão no Planejamento. A saída altera o saldo da conta, mas não entra novamente nos gastos variáveis. Compras ainda não previstas precisam ser incluídas no orçamento.</p>}</div>}
    <label className="checkbox-row"><input type="checkbox" checked={status === 'paid'} onChange={(e) => setStatus(e.target.checked ? 'paid' : 'pending')} /><span>Já foi {kind === 'expense' ? 'pago' : 'recebido'}</span></label>
    {status === 'paid' && <label>Data do {kind === 'expense' ? 'pagamento' : 'recebimento'}<input required type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></label>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {entry?.planId && <p className="form-note linked-entry-note"><CalendarDays size={15} />Vinculado ao Planejamento de {entry.planMonth ? monthName(entry.planMonth) : 'um mês'}. Esta edição altera somente este lançamento; a previsão dos próximos meses permanece.</p>}<p className="form-note"><HardDrive size={14} /> Alterações salvas no Google Sheets.</p>
    <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? 'Salvando…' : entry ? 'Salvar alterações' : 'Adicionar lançamento'}</button></div>
  </form>;
}

function AccountForm({ account, onClose, onSaved }: { account?: Account; onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const [balance, setBalance] = useState(account ? inputMoney(account.openingBalanceCents) : '0,00');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return; setSaving(true); setError('');
    const values = new FormData(event.currentTarget);
    try {
      const input = { name: String(values.get('name')), type: values.get('type') as Account['type'], openingBalanceCents: parseMoney(balance) };
      if (account) await updateAccount(account.id, input); else await addAccount(input);
      onSaved();
    } catch (e) { setError(errorText(e)); setSaving(false); }
  }
  return <form className="form" onSubmit={submit}>
    <label>Nome da conta<input autoFocus required name="name" maxLength={80} defaultValue={account?.name ?? ''} placeholder="Ex.: minha conta do banco" /></label>
    <label>Tipo<select name="type" defaultValue={account?.type ?? 'bank'}><option value="bank">Conta bancária</option><option value="cash">Dinheiro em mãos</option></select></label>
    <label>Saldo inicial em reais<input required name="balance" inputMode="decimal" value={balance} onChange={(event) => setBalance(event.target.value)} /></label>
    <p className="muted small">{account ? 'Alterar o saldo inicial recalcula o saldo atual da conta. Os lançamentos já registrados serão preservados.' : 'Informe o saldo anterior aos lançamentos que você vai registrar nesta conta.'}</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? 'Salvando…' : account ? 'Salvar alterações' : 'Criar conta'}</button></div>
  </form>;
}

function CategoryForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return; setSaving(true);
    const values = new FormData(event.currentTarget);
    try { await addCategory({ name: String(values.get('name')), kind: values.get('kind') as Category['kind'], color: String(values.get('color')) }); onSaved(); }
    catch (e) { setError(errorText(e)); setSaving(false); }
  }
  return <form className="form" onSubmit={submit}><label>Nome da categoria<input autoFocus required name="name" maxLength={60} placeholder="Ex.: pets" /></label><div className="form-grid"><label>Tipo<select name="kind"><option value="expense">Despesa</option><option value="income">Receita</option></select></label><label>Cor<input type="color" name="color" defaultValue="#087f63" /></label></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={saving}>Adicionar categoria</button></div></form>;
}

function MovementChart({ data, month }: { data: FinanceSnapshot; month: string }) {
  const periods = Array.from({ length: 6 }, (_, index) => changeMonth(month, index - 5));
  const points = periods.map((period) => ({ period, ...monthSummary(data.accounts, data.entries, period) }));
  const maximum = Math.max(...points.flatMap((p) => [p.paidIncomeCents, p.paidExpenseCents]), 10000);
  const hasData = points.some((p) => p.paidIncomeCents || p.paidExpenseCents);
  return <div className="chart-wrap"><svg className="movement-chart" viewBox="0 0 600 210" role="img" aria-label="Gráfico de receitas recebidas e despesas pagas nos últimos seis meses">
    {[0, 1, 2, 3].map((line) => <g key={line}><line x1="70" x2="594" y1={20 + line * 48} y2={20 + line * 48} stroke="#e9eceb" strokeDasharray="4 5" /><text x="58" y={24 + line * 48} textAnchor="end" fill="#89928e" fontSize="10">{formatMoney(Math.round(maximum * (3 - line) / 3))}</text></g>)}
    {points.map((point, index) => <g key={point.period}><rect x={96 + index * 85} y={164 - point.paidIncomeCents / maximum * 144} width="19" height={Math.max(point.paidIncomeCents / maximum * 144, hasData ? 0 : 2)} rx="4" fill="#178369"><title>{monthName(point.period)}: receitas {formatMoney(point.paidIncomeCents)}</title></rect><rect x={120 + index * 85} y={164 - point.paidExpenseCents / maximum * 144} width="19" height={Math.max(point.paidExpenseCents / maximum * 144, hasData ? 0 : 2)} rx="4" fill="#d8b584"><title>{monthName(point.period)}: despesas {formatMoney(point.paidExpenseCents)}</title></rect><text x={117 + index * 85} y="195" textAnchor="middle" fill="#7b857f" fontSize="12">{monthName(point.period, true).replace('.', '')}</text></g>)}
  </svg>{!hasData && <div className="chart-empty">Seu histórico começa com o primeiro pagamento.</div>}</div>;
}

function CategoryChart({ data, month }: { data: FinanceSnapshot; month: string }) {
  const expenses = data.entries.filter((e) => e.kind === 'expense' && e.occurredOn.startsWith(month));
  const total = expenses.reduce((s, e) => s + e.amountCents, 0);
  const groups = data.categories.map((c) => ({ ...c, total: expenses.filter((e) => e.categoryId === c.id).reduce((s, e) => s + e.amountCents, 0) })).filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
  let offset = 0;
  return <><div className="donut-wrap"><svg viewBox="0 0 160 160" role="img" aria-label={total ? `Despesas por categoria: total ${formatMoney(total)}` : 'Nenhuma despesa registrada neste mês'}><circle cx="80" cy="80" r="60" fill="none" stroke="#eef1ed" strokeWidth="16" />{groups.map((group) => { const length = group.total / total * 376.991; const start = offset; offset += length; return <circle key={group.id} cx="80" cy="80" r="60" fill="none" stroke={group.color} strokeWidth="16" strokeDasharray={`${length} ${376.991 - length}`} strokeDashoffset={-start} transform="rotate(-90 80 80)" />; })}</svg><div className="donut-label"><span>Despesas</span><strong>{formatMoney(total)}</strong></div></div><div className="category-legend">{groups.length ? groups.slice(0, 4).map((group) => <div key={group.id}><span><i style={{ background: group.color }} />{group.name}</span><strong>{Math.round(group.total / total * 100)}%</strong></div>) : <p className="muted small">As categorias aparecerão conforme você registrar suas despesas.</p>}</div></>;
}

function EntryRows({ entries, data, onEdit, onSettle, onDelete, busyId, dateBasis = 'occurred' }: { entries: Entry[]; data: FinanceSnapshot; onEdit: (entry: Entry) => void; onSettle: (entry: Entry) => void; onDelete: (entry: Entry) => void; busyId: string | null; dateBasis?: 'occurred' | 'paid' }) {
  if (!entries.length) return <div className="empty-state"><ReceiptText size={30} strokeWidth={1.4} /><h3>Nenhum lançamento por aqui</h3><p>Adicione uma receita ou despesa para começar.</p></div>;
  return <div className="entries-table"><div className="table-heading"><span>Descrição</span><span>{dateBasis === 'paid' ? 'Liquidação' : 'Data'}</span><span>Situação</span><span className="align-right">Valor</span><span /></div>{entries.map((entry) => {
    const category = data.categories.find((c) => c.id === entry.categoryId);
    const account = data.accounts.find((a) => a.id === entry.accountId);
    const late = entry.status === 'pending' && entry.dueOn < localDate();
    return <div className="entry-row" key={entry.id}>
      <div className="entry-description"><span className={`entry-icon ${entry.kind}`} style={{ color: category?.color }}>{entry.kind === 'income' ? <ArrowDownLeft size={18} /> : <ReceiptText size={18} />}</span><div><strong>{entry.description}</strong><span>{entry.isCardPayment ? 'Pagamento de fatura' : category?.name} <b>·</b> {account?.name}</span></div></div>
      <span className="entry-date">{dateLabel(dateBasis === 'paid' ? entry.paidOn ?? entry.occurredOn : entry.occurredOn)}</span>
      <span className={`status-tag ${entry.status === 'paid' ? 'paid' : late ? 'late' : 'pending'}`}>{entry.status === 'paid' ? <Check size={12} /> : <Clock3 size={12} />}{entry.status === 'paid' ? entry.kind === 'income' ? 'Recebido' : 'Pago' : late ? 'Em atraso' : 'Pendente'}</span>
      <strong className={`entry-amount ${entry.kind === 'income' ? 'positive' : ''}`}>{entry.kind === 'income' ? '+' : '−'} {formatMoney(entry.amountCents)}</strong>
      <div className="row-actions">{entry.status === 'pending' && <button disabled={busyId === entry.id} className="icon-button settle-button" title={entry.kind === 'income' ? 'Marcar como recebido hoje' : 'Marcar como pago hoje'} aria-label={`${entry.kind === 'income' ? 'Receber' : 'Pagar'} ${entry.description}`} onClick={() => onSettle(entry)}><CheckCircle2 size={17} /></button>}<button className="icon-button" title="Editar lançamento" aria-label={`Editar ${entry.description}`} onClick={() => onEdit(entry)}><Pencil size={15} /></button><button className="icon-button danger-icon" title="Excluir lançamento" aria-label={`Excluir ${entry.description}`} onClick={() => onDelete(entry)}><Trash2 size={15} /></button></div>
    </div>;
  })}</div>;
}

export default function App() {
  const [data, setData] = useState<FinanceSnapshot | null>(null);
  const [planningData, setPlanningData] = useState<PlanningSnapshot | null>(null);
  const [fatal, setFatal] = useState('');
  const [page, setPage] = useState<Page>('dashboard');
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [entryModal, setEntryModal] = useState<Entry | 'new' | null>(null);
  const [accountModal, setAccountModal] = useState<Account | 'new' | null>(null);
  const [categoryModal, setCategoryModal] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [dateBasis, setDateBasis] = useState<'occurred' | 'paid'>('occurred');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; description: string; action: () => Promise<void>; button: string } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [sessionPersistent, setSessionPersistent] = useState(true);
  const restoreInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const readConfirmedState = async () => {
      try {
        const [finance, planning] = await Promise.all([snapshot(), getPlanningSnapshot()]);
        if (!cancelled) {
          setData(finance); setPlanningData(planning);
          setSessionPersistent(getSessionInfo().persistent);
        }
      } catch (error) { if (!cancelled) setFatal(errorText(error)); }
    };
    const unsubscribe = subscribeState(() => { void readConfirmedState(); });
    initialize().then(readConfirmedState).catch((error) => { if (!cancelled) setFatal(errorText(error)); });
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline);
    return () => { cancelled = true; unsubscribe(); window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 5500); return () => clearTimeout(timer); }, [notice]);

  useEffect(() => setConfirmError(''), [confirm]);
  const selected = useMemo(() => data ? entriesForPeriod(data.entries, month, page === 'entries' ? dateBasis : 'occurred').sort((a, b) => { const reference = page === 'entries' && dateBasis === 'paid' ? 'paidOn' : 'occurredOn'; return (b[reference] ?? '').localeCompare(a[reference] ?? '') || b.createdAt.localeCompare(a.createdAt); }) : [], [data, month, page, dateBasis]);
  const filtered = useMemo(() => selected.filter((entry) => {
    const category = data?.categories.find((c) => c.id === entry.categoryId)?.name ?? '';
    const normalized = `${entry.description} ${category}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const text = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return normalized.includes(text) && (filter === 'all' || entry.kind === filter || entry.status === filter);
  }), [selected, query, filter, data]);

  function notify(message: string, error = false) { setNotice({ message, error }); }
  async function settle(entry: Entry) { setBusyId(entry.id); try { await settleEntry(entry.id, entry.version); notify(entry.kind === 'income' ? 'Recebimento salvo no servidor.' : 'Pagamento salvo no servidor.'); } catch (e) { notify(errorText(e), true); } finally { setBusyId(null); } }
  async function backup() { try { downloadFile(await exportBackup(), `compasso-backup-${localDate()}.json`, 'application/json'); notify('Cópia de segurança exportada. Guarde o arquivo em um lugar seguro.'); } catch (e) { notify(errorText(e), true); } }
  function exportCsv() {
    if (!data) return;
    const quote = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? "'" : '') + value.replace(/"/g, '""')}"`;
    const rows = [['Descrição', 'Tipo', 'Valor (R$)', 'Categoria', 'Conta', 'Data', 'Vencimento', 'Situação', 'Pagamento'], ...filtered.map((e) => [e.description, e.kind === 'income' ? 'Receita' : 'Despesa', inputMoney(e.amountCents), data.categories.find((c) => c.id === e.categoryId)?.name ?? '', data.accounts.find((a) => a.id === e.accountId)?.name ?? '', e.occurredOn, e.dueOn, e.status === 'paid' ? 'Liquidado' : 'Pendente', e.paidOn ?? ''])];
    downloadFile('\uFEFF' + rows.map((row) => row.map(quote).join(';')).join('\r\n'), `compasso-${month}.csv`, 'text/csv;charset=utf-8');
  }
  async function readRestore(file?: File) {
    if (!file) return;
    if (file.size > 2_000_000) { notify('Escolha uma cópia de segurança de até 2 MB.', true); return; }
    try {
      const raw = await file.text();
      setConfirm({ title: 'Restaurar cópia de segurança?', description: 'Os dados desta sessão serão substituídos pelo conteúdo do arquivo. Exporte uma cópia antes de continuar.', button: 'Restaurar dados', action: async () => { await restoreBackup(raw); notify('Cópia de segurança restaurada.'); } });
    } catch (e) { notify(errorText(e), true); }
  }

  if (fatal) return <div className="startup"><Compass size={36} /><h1>Não foi possível abrir seus dados</h1><p>{fatal}</p><p>Verifique a conexão e abra o aplicativo pelo endereço do Google Apps Script.</p><button className="button primary" onClick={() => window.location.reload()}>Tentar novamente</button></div>;
  if (!data) return <div className="startup"><Compass size={40} className="loading-logo" /><h1>Compasso</h1><p>Abrindo seu espaço…</p></div>;

  const summary = monthSummary(data.accounts, data.entries, month);
  const hasPlans = Boolean(planningData?.plans.length);
  const budget = hasPlans && planningData ? monthlyPlanningSummary(planningData.plans, planningData.occurrences, data.entries, month) : null;
  const upcoming = data.entries.filter((e) => e.kind === 'expense' && e.status === 'pending').sort((a, b) => a.dueOn.localeCompare(b.dueOn)).slice(0, 4);
  const currentPageTitle = page === 'dashboard' ? 'Seu mês, em perspectiva.' : page === 'planning' ? 'Seu salário, seu mês, suas escolhas.' : page === 'entries' ? 'Cada movimento conta.' : page === 'accounts' ? 'Seu dinheiro, organizado.' : page === 'history' ? 'Uma visão de cada mês.' : 'Do seu jeito.';

  return <div className="app-shell">
    <aside className="sidebar"><a href="#inicio" className="brand" onClick={(event) => { event.preventDefault(); setPage('dashboard'); }} aria-label="Compasso, visão geral"><span className="brand-mark"><Compass size={25} strokeWidth={1.8} /></span><span>compasso<span className="brand-dot">.</span></span></a><div className="workspace-label">SEU ESPAÇO FINANCEIRO</div><button className="workspace-picker" onClick={() => { setPage('settings'); document.getElementById('main-content')?.focus(); }}><span className="workspace-icon"><FolderHeart size={18} /></span><span><strong>Meu espaço</strong><small>Demonstração</small></span><ChevronDown size={16} /></button><div className="nav-label">PRINCIPAL</div><nav aria-label="Navegação principal">{navigation.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} aria-current={page === id ? 'page' : undefined} onClick={() => { setPage(id); setQuery(''); if (id === 'entries') { setDateBasis('occurred'); setFilter('all'); } }}><Icon size={19} /><span>{label}</span>{page === id && <span className="nav-active-dot" />}</button>)}</nav><div className="sidebar-bottom"><div className="local-note"><span className="local-note-icon"><ShieldCheck size={19} /></span><strong>Seu controle, seu ritmo.</strong><p>Organize hoje.<br />Cuide do seu amanhã.</p></div><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}><Settings size={19} /><span>Preferências</span></button><div className="profile"><span className="avatar">{(data.settings.displayName || 'Você').slice(0, 1).toUpperCase()}</span><div><strong>{data.settings.displayName || 'Você'}</strong><span>Finanças pessoais</span></div><span className="profile-dot" /></div></div></aside>

    <div className="main-shell"><header className="topbar"><div className="mobile-brand"><Compass size={25} /><strong>compasso.</strong></div><div className="breadcrumb">Meu espaço <span>/</span> <strong>{page === 'dashboard' ? 'Visão geral' : page === 'entries' ? 'Lançamentos' : page === 'planning' ? 'Planejamento' : page === 'accounts' ? 'Contas e saldos' : page === 'history' ? 'Histórico' : 'Preferências'}</strong></div><div className="topbar-end"><span className={`local-status ${!online ? 'offline' : ''}`}>{online ? <HardDrive size={14} /> : <WifiOff size={14} />}<span>{online ? 'Google Sheets' : 'Sem conexão'}</span></span><span className="topbar-avatar">{(data.settings.displayName || 'Você').slice(0, 1).toUpperCase()}</span></div></header>

    <main id="main-content" tabIndex={-1}>
      <div className="academic-demo-banner"><Info size={18} /><div><strong>Demonstração com dados fictícios</strong><p>As alterações são salvas no Google Sheets, apenas na sua sessão.</p></div><a href="https://github.com/tharibbeiro/PROJ_IMPACTA_COMPASSO/tree/main/docs" target="_blank" rel="noopener" className="text-button">Projeto <ArrowRight size={14} /></a><button className="text-button" onClick={() => setConfirm({ title: 'Reiniciar demonstração?', description: 'Uma nova sessão será criada com dados fictícios. Exporte uma cópia antes se quiser guardar suas alterações.', button: 'Reiniciar demonstração', action: async () => { await seedExampleData(); notify('Demonstração reiniciada com dados fictícios.'); } })}>Reiniciar</button></div>
      {!sessionPersistent && <div className="info-box session-storage-note" role="status"><Info size={17} /><p>Este navegador não permite guardar a sessão. Mantenha esta aba aberta: ao reabrir, uma nova demonstração será criada.</p></div>}
      {data.settings.exampleMode && <div className="example-banner"><Info size={17} /><span>Modo exemplo · todos os lançamentos são temporários.</span><button onClick={() => setConfirm({ title: 'Começar com seus dados?', description: 'Todos os lançamentos registrados no modo exemplo serão removidos, inclusive os que você adicionou ou editou. Contas e categorias serão mantidas. Exporte uma cópia se quiser guardá-los.', button: 'Remover exemplos', action: async () => { await resetExampleData(); notify('Exemplos removidos. Tudo pronto para começar.'); } })}>Começar com meus dados <ArrowRight size={14} /></button></div>}
      <div className="page-heading"><div><span className="eyebrow">{page === 'dashboard' ? 'VISÃO GERAL' : 'SUAS FINANÇAS, COM CLAREZA'}</span><h1>{currentPageTitle}</h1><p>{page === 'dashboard' ? 'Um pouco de clareza para cuidar do que importa.' : page === 'planning' ? 'Salário, despesas fixas e parcelas em um planejamento que acompanha você.' : page === 'entries' ? 'Registre, acompanhe e mantenha suas contas em dia.' : page === 'accounts' ? 'Acompanhe o saldo das suas contas em um só lugar.' : page === 'history' ? 'Acompanhe sua trajetória, uma escolha de cada vez.' : 'Personalize seu espaço e cuide dos seus dados.'}</p></div>{page !== 'settings' && page !== 'planning' && <button className="button primary" onClick={() => page === 'accounts' ? setAccountModal('new') : setEntryModal('new')}><Plus size={18} />{page === 'accounts' ? 'Nova conta' : 'Novo lançamento'}</button>}</div>

      {(page === 'dashboard' || page === 'entries') && <div className="period-row"><div className="period-control"><button className="icon-button" aria-label="Mês anterior" onClick={() => setMonth(changeMonth(month, -1))}><ChevronLeft size={17} /></button><label><CalendarDays size={16} /><span>{monthName(month)}</span><input type="month" value={month} aria-label="Selecionar mês" onChange={(e) => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) setMonth(e.target.value); }} /></label><button className="icon-button" aria-label="Próximo mês" onClick={() => setMonth(changeMonth(month, 1))}><ChevronRight size={17} /></button></div><span className="period-hint">{selected.length} {selected.length === 1 ? 'lançamento no mês' : 'lançamentos no mês'}</span></div>}

      {page === 'dashboard' && <>
        <section className="planning-invitation"><span className="planning-invitation-icon"><CalendarDays size={24} /></span><div><h2>{budget ? `Livre no orçamento do mês: ${formatMoney(budget.availableCents)}` : 'Quanto ainda posso gastar este mês?'}</h2><p>{budget ? 'Previsão após compromissos, reservas e gastos variáveis. Confira os detalhes no Planejamento.' : 'Configure salário, adiantamento, gastos fixos e parcelas no Planejamento.'}</p></div><button className="button primary" onClick={() => setPage('planning')}>Planejar meu mês <ArrowRight size={16} /></button></section>
        <section className="summary-grid" aria-label="Resumo financeiro"><article className="summary-card balance"><div className="summary-card-top"><span>Saldo nas contas</span><Wallet size={19} /></div><strong>{formatMoney(summary.balanceCents)}</strong><span className="summary-foot"><span className="little-dot" />Saldo realizado em todas as contas</span></article><article className="summary-card"><div className="summary-card-top"><span>Receitas do mês</span><span className="metric-icon income"><ArrowDownLeft size={17} /></span></div><strong>{formatMoney(summary.incomeCents)}</strong><span className="summary-foot">Pela data do lançamento</span></article><article className="summary-card"><div className="summary-card-top"><span>Despesas do mês</span><span className="metric-icon expense"><ArrowUpRight size={17} /></span></div><strong>{formatMoney(summary.expenseCents)}</strong><span className="summary-foot">Pela data do lançamento</span></article><article className="summary-card"><div className="summary-card-top"><span>A pagar no mês</span><span className="metric-icon pending"><Clock3 size={17} /></span></div><strong>{formatMoney(summary.pendingCents)}</strong><span className="summary-foot">Despesas pendentes por vencimento</span></article></section>
        {!hasPlans && data.entries.length === 0 && data.accounts.length === 1 && data.accounts[0].id === 'account-main' && data.accounts[0].openingBalanceCents === 0 && <section className="welcome-card"><div className="welcome-art" aria-hidden="true"><Compass size={48} strokeWidth={1.1} /></div><div><span className="eyebrow">UM BOM PONTO DE PARTIDA</span><h2>Mais clareza. Um lançamento de cada vez.</h2><p>Comece com uma receita ou despesa. O Compasso organiza o resto com você.</p></div><button className="button light" onClick={async () => { try { await seedExampleData(); notify('Exemplos carregados. Você pode removê-los quando quiser.'); } catch (e) { notify(errorText(e), true); } }}>Explorar exemplo <ArrowRight size={16} /></button></section>}
        <div className="charts-grid"><section className="panel"><div className="panel-heading"><div><h2>Entradas e saídas</h2><p>Movimentações realizadas nos últimos 6 meses</p><button className="text-button history-link" onClick={() => setPage('history')}>Abrir histórico anual <ArrowRight size={13} /></button></div><div className="chart-legend"><span><i className="income-dot" />Receitas</span><span><i className="expense-dot" />Despesas</span></div></div><MovementChart data={data} month={month} /></section><section className="panel category-panel"><div className="panel-heading"><div><h2>Para onde vai seu dinheiro</h2><p>Despesas por categoria no mês</p></div></div><CategoryChart data={data} month={month} /></section></div>
        <div className="bottom-grid"><section className="panel latest-panel"><div className="panel-heading"><div><h2>Últimos lançamentos</h2><p>Pequenos movimentos, visão completa.</p></div><button className="text-button" onClick={() => setPage('entries')}>Ver todos <ArrowRight size={15} /></button></div><EntryRows entries={selected.slice(0, 4)} data={data} onEdit={setEntryModal} onSettle={settle} onDelete={(entry) => setConfirm({ title: 'Excluir lançamento?', description: `“${entry.description}” será removido e o saldo será recalculado.`, button: 'Excluir lançamento', action: async () => { await deleteEntry(entry.id, entry.version); notify('Lançamento excluído.'); } })} busyId={busyId} /></section><section className="panel upcoming-panel"><div className="panel-heading"><div><h2>No seu radar</h2><p>Próximas despesas a pagar</p></div><CalendarDays size={20} className="muted" /></div>{upcoming.length ? upcoming.map((entry) => <button className="upcoming-row" key={entry.id} onClick={() => setEntryModal(entry)}><span className={`due-date ${entry.dueOn < localDate() ? 'overdue' : ''}`}><strong>{entry.dueOn.slice(8)}</strong><span>{new Date(`${entry.dueOn}T12:00:00`).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</span></span><span className="upcoming-name"><strong>{entry.description}</strong><small>{entry.dueOn < localDate() ? 'Em atraso' : 'A pagar'}</small></span><strong className="upcoming-amount">{formatMoney(entry.amountCents)}</strong></button>) : <div className="empty-radar"><span><CheckCircle2 size={27} strokeWidth={1.5} /></span><h3>Tudo tranquilo por aqui</h3><p>Suas despesas pendentes aparecerão aqui.</p></div>}</section></div>
      </>}

      {page === 'entries' && <section className="panel"><div className="entries-toolbar"><label className="search-field"><Search size={17} /><input placeholder="Buscar descrição ou categoria" aria-label="Buscar lançamentos" value={query} onChange={(e) => setQuery(e.target.value)} /></label><select className="filter-select" aria-label="Referência do período" value={dateBasis} onChange={(e) => setDateBasis(e.target.value as typeof dateBasis)}><option value="occurred">Data do lançamento</option><option value="paid">Data do pagamento</option></select><select className="filter-select" aria-label="Filtrar lançamentos" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">Todos os lançamentos</option><option value="expense">Despesas</option><option value="income">Receitas</option><option value="pending">Pendentes</option><option value="paid">Pagos e recebidos</option></select><button className="button secondary compact" onClick={exportCsv}><Download size={16} />Exportar mês</button></div><EntryRows entries={filtered} dateBasis={dateBasis} data={data} onEdit={setEntryModal} onSettle={settle} onDelete={(entry) => setConfirm({ title: 'Excluir lançamento?', description: `“${entry.description}” será removido e o saldo será recalculado.`, button: 'Excluir lançamento', action: async () => { await deleteEntry(entry.id, entry.version); notify('Lançamento excluído.'); } })} busyId={busyId} /><div className="table-footer"><span>{filtered.length} {filtered.length === 1 ? 'lançamento' : 'lançamentos'}</span><span>Referência: {dateBasis === 'paid' ? 'pagamento ou recebimento' : 'data do lançamento'}</span></div></section>}

      {page === 'planning' && (data.settings.exampleMode ? <section className="panel planning-demo-gate"><CalendarDays size={30} /><h2>Seu planejamento começa com seus dados.</h2><p>Você está no modo exemplo. Remova os lançamentos temporários antes de cadastrar seu salário, seus compromissos e suas reservas.</p><button className="button primary" onClick={() => setConfirm({ title: 'Começar seu planejamento?', description: 'Todos os lançamentos registrados no modo exemplo serão removidos. Contas e categorias serão mantidas. Exporte uma cópia se quiser guardar os exemplos.', button: 'Começar meu planejamento', action: async () => { await resetExampleData(); notify('Tudo pronto para cadastrar seu planejamento.'); } })}>Começar meu planejamento <ArrowRight size={16} /></button></section> : <PlanningPage month={month} onMonthChange={setMonth} accounts={data.accounts} categories={data.categories} entries={data.entries} onNotify={notify} />)}

      {page === 'accounts' && <><div className="account-grid">{data.accounts.map((account) => <article className="panel account-card" key={account.id}><div className="account-top"><span className="account-icon">{account.type === 'bank' ? <Landmark size={25} /> : <Banknote size={25} />}</span><span className="status-tag paid">Ativa</span></div><h2>{account.name}</h2><p>{account.type === 'bank' ? 'Conta bancária' : 'Dinheiro em mãos'}</p><span className="account-balance-label">Saldo atual</span><strong className="account-balance">{formatMoney(accountBalance(account, data.entries))}</strong><div className="account-footer"><span>Saldo inicial</span><strong>{formatMoney(account.openingBalanceCents)}</strong></div><button className="button secondary full-width account-edit-button" onClick={() => setAccountModal(account)}><Pencil size={15} />Editar conta</button></article>)}</div><div className="info-box"><Info size={18} /><p>Esta área reúne bancos e dinheiro em mãos. Para configurar salário, gastos fixos, assinaturas e parcelas, use Planejamento. Os saldos consideram somente o valor inicial e os lançamentos pagos ou recebidos.</p></div></>}

      {page === 'history' && <><section className="panel"><div className="panel-heading history-heading"><div><h2>Seu ano em números</h2><p>Fluxo de caixa pelos pagamentos e recebimentos realizados.</p></div><label className="year-field">Ano<select value={month.slice(0, 4)} onChange={(e) => setMonth(`${e.target.value}-${month.slice(5)}`)}>{Array.from(new Set([Number(localDate().slice(0, 4)), Number(month.slice(0, 4)), ...data.entries.map((e) => Number(e.occurredOn.slice(0, 4))), ...data.entries.filter((e) => e.paidOn).map((e) => Number(e.paidOn!.slice(0, 4)))])).sort((a, b) => b - a).map((year) => <option key={year}>{year}</option>)}</select></label></div><div className="history-table"><div className="history-row heading"><span>Mês</span><span>Recebido</span><span>Pago</span><span>Resultado</span></div>{Array.from({ length: 12 }, (_, index) => { const period = `${month.slice(0, 4)}-${String(index + 1).padStart(2, '0')}`; const s = monthSummary(data.accounts, data.entries, period); return <button className={`history-row ${period === month ? 'current' : ''}`} key={period} onClick={() => { setMonth(period); setDateBasis('paid'); setFilter('all'); setQuery(''); setPage('entries'); }}><span>{monthName(period, true).replace('.', '')}</span><span className="positive">{formatMoney(s.paidIncomeCents)}</span><span>{formatMoney(s.paidExpenseCents)}</span><strong className={s.monthlyBalanceCents < 0 ? 'negative' : 'positive'}>{formatMoney(s.monthlyBalanceCents)}</strong></button>; })}</div></section><div className="info-box"><CalendarDays size={18} /><p>Selecione um mês para abrir seus lançamentos. O resultado mostra receitas recebidas menos despesas pagas; não inclui saldos iniciais.</p></div></>}

      {page === 'settings' && <div className="settings-grid"><section className="panel settings-panel"><div className="panel-heading"><div><h2>Seu espaço</h2><p>Pequenos detalhes que deixam tudo mais seu.</p></div><FolderHeart size={20} className="muted" /></div><form className="form profile-form" onSubmit={async (event) => { event.preventDefault(); const values = new FormData(event.currentTarget); try { await savePreferences({ displayName: String(values.get('displayName')) }); notify('Preferência salva.'); } catch (e) { notify(errorText(e), true); } }}><label>Como você quer ser chamado(a)?<input name="displayName" maxLength={60} required defaultValue={data.settings.displayName || 'Você'} /></label><div className="settings-details"><span>Moeda<strong>Real brasileiro · BRL</strong></span><span>Visibilidade<strong>Demonstração · dados fictícios</strong></span></div><button className="button secondary" type="submit">Salvar preferência</button></form><div className="settings-divider" /><div className="settings-section"><h3>Categorias</h3><p className="muted small">Organize seus lançamentos do seu jeito.</p><div className="category-chips">{data.categories.map((category) => <span key={category.id}><i style={{ background: category.color }} />{category.name}<small>{category.kind === 'income' ? 'Receita' : 'Despesa'}</small></span>)}</div><button className="text-button" onClick={() => setCategoryModal(true)}><Plus size={16} />Adicionar categoria</button></div></section><div className="settings-stack"><section className="panel settings-panel"><div className="panel-heading"><div><h2>Cuide dos seus dados</h2><p>Exporte uma cópia dos seus registros.</p></div><ShieldCheck size={21} className="muted" /></div><div className="backup-description"><p>Os dados desta demonstração são salvos no Google Sheets. Exporte uma cópia antes de reiniciar se quiser guardar suas alterações.</p><button className="button primary full-width" onClick={backup}><Download size={17} />Exportar cópia de segurança</button><button className="button secondary full-width" onClick={() => restoreInput.current?.click()}><Upload size={17} />Restaurar cópia do Compasso</button><input type="file" ref={restoreInput} hidden accept=".json,application/json" onChange={(e) => { void readRestore(e.target.files?.[0]); e.target.value = ''; }} /><p className="small muted">Restaure somente arquivos JSON exportados nesta demonstração.</p></div></section><section className="panel settings-panel"><div className="panel-heading"><div><h2>Acesso aos dados</h2><p>Google Apps Script e Google Sheets.</p></div><Compass size={22} className="muted" /></div><div className="backup-description"><p>Abra o aplicativo pelo endereço de implantação do Apps Script. É preciso internet para carregar e salvar os dados.</p><p className="small muted">A tela mantém apenas uma cópia em memória enquanto esta aba está aberta. As informações confirmadas ficam no Google Sheets.</p></div></section><section className="next-step-card"><FolderHeart size={24} /><div><h3>Como funciona</h3><p>As telas em React enviam as informações ao Google Apps Script. Ele aplica as regras financeiras e salva os dados no Google Sheets.</p><a className="text-button" href="https://github.com/tharibbeiro/PROJ_IMPACTA_COMPASSO/tree/main/docs" target="_blank" rel="noopener">Sobre o projeto <ArrowRight size={15} /></a></div></section></div></div>}
      <footer className="page-footer"><span>compasso<span className="brand-dot">.</span> </span><span>Demonstração</span></footer>
    </main></div>
    <nav className="mobile-nav" aria-label="Navegação no celular">{navigation.filter(({ id }) => id !== 'history').map(({ id, label, icon: Icon }) => <button key={id} aria-current={page === id ? 'page' : undefined} className={page === id ? 'active' : ''} onClick={() => { setPage(id); if (id === 'entries') { setDateBasis('occurred'); setFilter('all'); setQuery(''); } }}><Icon size={20} /><span>{id === 'dashboard' ? 'Início' : id === 'planning' ? 'Plano' : id === 'entries' ? 'Gastos' : id === 'accounts' ? 'Contas' : label}</span></button>)}<button className={page === 'settings' ? 'active' : ''} aria-current={page === 'settings' ? 'page' : undefined} onClick={() => setPage('settings')}><Settings size={20} /><span>Ajustes</span></button></nav>
    {notice && <div className={`toast ${notice.error ? 'toast-error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <Info size={19} /> : <CheckCircle2 size={19} />}<span>{notice.message}</span><button aria-label="Fechar mensagem" onClick={() => setNotice(null)}><X size={16} /></button></div>}
    {entryModal && <Modal title={entryModal === 'new' ? 'Novo lançamento' : 'Editar lançamento'} onClose={() => setEntryModal(null)} wide><EntryForm entry={entryModal === 'new' ? undefined : entryModal} accounts={data.accounts} categories={data.categories} onClose={() => setEntryModal(null)} onSaved={(saved) => { setEntryModal(null); setMonth(saved.occurredOn.slice(0, 7)); setDateBasis('occurred'); setFilter('all'); setQuery(''); notify('Lançamento salvo no servidor.'); }} /></Modal>}
    {accountModal && <Modal title={accountModal === 'new' ? 'Nova conta' : 'Editar conta'} onClose={() => setAccountModal(null)}><AccountForm account={accountModal === 'new' ? undefined : accountModal} onClose={() => setAccountModal(null)} onSaved={() => { const edited = accountModal !== 'new'; setAccountModal(null); notify(edited ? 'Conta atualizada.' : 'Conta criada.'); }} /></Modal>}
    {categoryModal && <Modal title="Nova categoria" onClose={() => setCategoryModal(false)}><CategoryForm onClose={() => setCategoryModal(false)} onSaved={() => { setCategoryModal(false); notify('Categoria criada.'); }} /></Modal>}
    {confirm && <Modal title={confirm.title} onClose={() => { if (!confirmBusy) setConfirm(null); }}><div className="form"><p className="confirmation-text">{confirm.description}</p>{confirmError && <p className="form-error" role="alert">{confirmError}</p>}<div className="modal-actions"><button className="button secondary" disabled={confirmBusy} onClick={() => setConfirm(null)}>Cancelar</button><button className="button primary" disabled={confirmBusy} onClick={async () => { setConfirmBusy(true); try { await confirm.action(); setConfirm(null); } catch (e) { setConfirmError(errorText(e)); } finally { setConfirmBusy(false); } }}>{confirmBusy ? 'Aguarde…' : confirm.button}</button></div></div></Modal>}
  </div>;
}
