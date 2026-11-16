import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { liveQuery } from 'dexie';
import {
  ArchiveX, ArrowDownLeft, ArrowRight, Banknote, CalendarDays, Check,
  CheckCircle2, ChevronLeft, ChevronRight, Clock3, CreditCard,
  HardDrive, Info, Layers3, Pencil, PiggyBank, Plus, ReceiptText,
  Sparkles, Wallet, X,
} from 'lucide-react';
import type { Account, Category, Entry } from '../domain/types';
import type { PlanInput, PlanItem, PlanningRow, PlanningSnapshot } from '../domain/planning-types';
import { formatMoney, localDate, parseMoney } from '../domain/finance';
import { monthlyPlanningSummary, rowsForMonth } from '../domain/planning';
import { deletePlan, getPlanningSnapshot, linkPlanEntry, savePlan, setPlanningChecked, settlePlan } from '../data/planning-repository';
import './planning.css';

interface PlanningPageProps {
  month: string;
  onMonthChange: (month: string) => void;
  accounts: Account[];
  categories: Category[];
  entries: Entry[];
  onNotify: (message: string, error?: boolean) => void;
}

type PlanType = PlanItem['type'];
type PlanEditor = { plan?: PlanItem; type: PlanType };
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível concluir. Tente novamente.';
const inputMoney = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
const monthLabel = (month: string) => new Date(`${month}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
const offsetMonth = (month: string, offset: number) => {
  const date = new Date(`${month}-15T12:00:00`);
  date.setMonth(date.getMonth() + offset);
  return localDate(date).slice(0, 7);
};
const isCashPlan = (type: PlanType) => type === 'salary' || type === 'fixed' || type === 'annual';
const isCardPlan = (type: PlanType) => type === 'cardFixed' || type === 'installment';

const GROUPS: { type: PlanType; title: string; subtitle: string; empty: string; addLabel: string; icon: typeof Wallet; className: string }[] = [
  { type: 'salary', title: 'Receitas previstas', subtitle: 'Salário e adiantamento entram em datas separadas.', empty: 'Adicione seu salário, adiantamento ou outra receita recorrente.', addLabel: 'Adicionar receita', icon: Banknote, className: 'income' },
  { type: 'fixed', title: 'Contas fixas', subtitle: 'Compromissos pagos diretamente por uma conta.', empty: 'Organize aluguel, internet, boletos e outras contas do mês.', addLabel: 'Adicionar conta fixa', icon: ReceiptText, className: 'fixed' },
  { type: 'cardFixed', title: 'Fixos no cartão', subtitle: 'Conferir não é pagar. Registre a saída em Lançamentos como pagamento de fatura já previsto.', empty: 'Inclua assinaturas e cobranças mensais dos seus cartões.', addLabel: 'Adicionar fixo no cartão', icon: CreditCard, className: 'card' },
  { type: 'installment', title: 'Compras parceladas', subtitle: 'Confira a parcela na fatura. O pagamento é registrado em Lançamentos como fatura já prevista.', empty: 'Cadastre a parcela deste mês e a quantidade total.', addLabel: 'Adicionar parcelamento', icon: Layers3, className: 'installment' },
  { type: 'annual', title: 'Compromissos anuais', subtitle: 'A previsão aparece no mês do vencimento anual.', empty: 'Cadastre despesas anuais, como seguros e anuidades.', addLabel: 'Adicionar compromisso anual', icon: CalendarDays, className: 'annual' },
  { type: 'reserve', title: 'Reservas do mês', subtitle: 'Separar uma reserva não cria uma despesa na conta.', empty: 'Planeje quanto deseja separar para seus objetivos.', addLabel: 'Adicionar reserva', icon: PiggyBank, className: 'reserve' },
];

function PlanningDialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = 'planning-dialog-title';
  useEffect(() => {
    const element = ref.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);
  return <dialog ref={ref} className={`modal planning-dialog ${wide ? 'planning-dialog-wide' : ''}`} aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === ref.current) onClose(); }}>
    <div className="modal-header"><div><span className="eyebrow">SEU PLANEJAMENTO</span><h2 id={titleId}>{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Fechar planejamento"><X size={20} /></button></div>
    {children}
  </dialog>;
}

function PlanForm({ editor, month, accounts, categories, onClose, onSaved }: {
  editor: PlanEditor; month: string; accounts: Account[]; categories: Category[];
  onClose: () => void; onSaved: (plan: PlanItem) => void;
}) {
  const existing = editor.plan;
  const [type, setType] = useState<PlanType>(existing?.type ?? editor.type);
  const [description, setDescription] = useState(existing?.description ?? '');
  const [amount, setAmount] = useState(existing ? inputMoney(existing.amountCents) : '');
  const [startMonth, setStartMonth] = useState(existing?.startMonth ?? month);
  const [dueDay, setDueDay] = useState(String(existing?.dueDay ?? 5));
  const [endMonth, setEndMonth] = useState(existing?.endMonth ?? '');
  const [accountId, setAccountId] = useState(existing?.accountId ?? accounts[0]?.id ?? '');
  const defaultCategory = (value: PlanType) => value === 'salary'
    ? categories.find((category) => category.id === 'income-salary')?.id ?? categories.find((category) => category.kind === 'income')?.id ?? ''
    : categories.find((category) => category.kind === 'expense')?.id ?? '';
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? defaultCategory(type));
  const [cardName, setCardName] = useState(existing?.cardName ?? '');
  const [installmentNumber, setInstallmentNumber] = useState(String(existing?.installmentNumber ?? 1));
  const [totalInstallments, setTotalInstallments] = useState(String(existing?.totalInstallments ?? 12));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const cash = isCashPlan(type);
  const matchingCategories = categories.filter((c) => c.kind === (type === 'salary' ? 'income' : 'expense'));
  const lastInstallmentMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth)
    && Number.isInteger(Number(installmentNumber)) && Number.isInteger(Number(totalInstallments))
    && Number(installmentNumber) > 0 && Number(totalInstallments) >= Number(installmentNumber)
    && Number(totalInstallments) <= 1200
    ? offsetMonth(startMonth, Number(totalInstallments) - Number(installmentNumber)) : '';

  function changeType(value: PlanType) {
    setType(value);
    setCategoryId(defaultCategory(value));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError('');
    try {
      const input: PlanInput = {
        type, description, amountCents: parseMoney(amount), startMonth, dueDay: Number(dueDay),
        ...(endMonth && type !== 'installment' ? { endMonth } : {}),
        ...(cash ? { accountId, categoryId } : {}),
        ...(isCardPlan(type) ? { cardName } : {}),
        ...(type === 'installment' ? { installmentNumber: Number(installmentNumber), totalInstallments: Number(totalInstallments) } : {}),
      };
      const saved = await savePlan(input, existing?.id, existing?.version);
      onSaved(saved);
    } catch (e) { setError(errorText(e)); setSaving(false); }
  }
  const placeholders: Record<PlanType, string> = {
    salary: 'Ex.: salário ou adiantamento', fixed: 'Ex.: aluguel ou internet', cardFixed: 'Ex.: assinatura de música',
    installment: 'Ex.: compra de um eletrodoméstico', annual: 'Ex.: seguro ou anuidade', reserve: 'Ex.: reserva de emergência',
  };

  return <form className="form planning-form" onSubmit={submit}>
    <label>Tipo de item<select value={type} onChange={(event) => changeType(event.target.value as PlanType)}>
      {GROUPS.map((group) => <option key={group.type} value={group.type}>{group.title}</option>)}
    </select></label>
    <label>Descrição<input autoFocus required maxLength={150} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={placeholders[type]} /></label>
    <label>{type === 'installment' ? 'Valor de cada parcela em reais' : type === 'reserve' ? 'Valor mensal a separar em reais' : type === 'annual' ? 'Valor anual em reais' : 'Valor mensal em reais'}<div className="planning-money-field"><span>R$</span><input required inputMode="decimal" placeholder="0,00" value={amount} onChange={(event) => setAmount(event.target.value)} aria-label={type === 'installment' ? 'Valor de cada parcela em reais' : 'Valor previsto em reais'} /></div></label>
    <div className="form-grid"><label>{type === 'installment' ? 'Mês de referência da parcela' : type === 'annual' ? 'Primeiro mês de vencimento' : 'Primeiro mês da previsão'}<input required type="month" min="1900-01" max="9999-12" value={startMonth} onChange={(event) => setStartMonth(event.target.value)} /></label><label>{type === 'salary' ? 'Dia do recebimento' : type === 'reserve' ? 'Dia para separar' : 'Dia do vencimento'}<input required type="number" min="1" max="31" step="1" value={dueDay} onChange={(event) => setDueDay(event.target.value)} /></label></div>
    {type === 'installment' && <div className="planning-installment-form">
      <div className="form-grid"><label>Parcela neste mês<input required type="number" min="1" max="1200" step="1" value={installmentNumber} onChange={(event) => setInstallmentNumber(event.target.value)} /></label><label>Total de parcelas<input required type="number" min="1" max="1200" step="1" value={totalInstallments} onChange={(event) => setTotalInstallments(event.target.value)} /></label></div>
      {lastInstallmentMonth && <p><Layers3 size={15} /><span>Em <strong>{monthLabel(startMonth)}</strong>, será a parcela <strong>{installmentNumber}/{totalInstallments}</strong>. Última prevista em <strong>{monthLabel(lastInstallmentMonth)}</strong>.</span></p>}
    </div>}
    {isCardPlan(type) && <label>Nome do cartão<input required maxLength={80} value={cardName} onChange={(event) => setCardName(event.target.value)} placeholder="Ex.: cartão principal" /></label>}
    {cash && <div className="form-grid"><label>Conta padrão<select required value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="" disabled>Selecione uma conta</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>Categoria<select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="" disabled>Selecione uma categoria</option>{matchingCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label></div>}
    {type !== 'installment' && <label>Último mês da previsão <span className="planning-optional">opcional</span><input type="month" min={startMonth || '1900-01'} max="9999-12" value={endMonth} onChange={(event) => setEndMonth(event.target.value)} /></label>}
    <div className="planning-form-context"><Info size={16} /><p>{type === 'salary' ? 'Salário e adiantamento devem ser dois itens, cada um com sua data. A receita só entra no saldo da conta ao registrar o recebimento.' : isCardPlan(type) ? 'Este valor compromete o orçamento mensal. Conferir o item na fatura não cria outra despesa nem registra o pagamento da fatura.' : type === 'reserve' ? 'A reserva reduz o valor livre do orçamento. Marcar como separado é um controle do planejamento e não movimenta a conta.' : 'A previsão entra no orçamento do mês. A conta só é movimentada ao registrar o pagamento.'}</p></div>
    {existing && <p className="planning-edit-note">As mudanças ajustam as previsões. Pagamentos e recebimentos já registrados mantêm seu histórico.</p>}
    <p className="planning-field-help">Vencimentos em dias que não existem no mês usam o último dia disponível.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <p className="form-note"><HardDrive size={14} />Alterações confirmadas pela API e salvas no banco SQL.</p>
    <div className="modal-actions"><button type="button" className="button secondary" disabled={saving} onClick={onClose}>Cancelar</button><button type="submit" className="button primary" disabled={saving}>{saving ? 'Salvando…' : existing ? 'Salvar previsão' : 'Adicionar ao planejamento'}</button></div>
  </form>;
}

function SettlementForm({ row, accounts, candidates, onClose, onSaved }: { row: PlanningRow; accounts: Account[]; candidates: Entry[]; onClose: () => void; onSaved: (result: 'linked' | 'settled') => void }) {
  const [paidOn, setPaidOn] = useState(localDate());
  const [accountId, setAccountId] = useState(row.plan.accountId ?? accounts[0]?.id ?? '');
  const [mode, setMode] = useState<'existing' | 'new'>(!row.linkedEntry && candidates.length ? 'existing' : 'new');
  const [entryId, setEntryId] = useState(candidates[0]?.id ?? '');
  const [confirmedDate, setConfirmedDate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const income = row.plan.type === 'salary';
  const selectedEntry = candidates.find((entry) => entry.id === entryId);
  const outsideMonth = paidOn.slice(0, 7) !== row.month;
  async function submit(event: FormEvent) {
    event.preventDefault(); if (saving) return;
    setSaving(true); setError('');
    try {
      if (mode === 'existing') {
        if (!selectedEntry) throw new Error('Selecione o lançamento que deseja vincular.');
        await linkPlanEntry(row.plan.id, row.month, selectedEntry.id, selectedEntry.version);
        onSaved('linked');
      } else {
        if (outsideMonth && !confirmedDate) throw new Error('Confirme a data fora do mês de referência antes de continuar.');
        await settlePlan(row.plan.id, row.month, { paidOn, accountId });
        onSaved('settled');
      }
    }
    catch (e) { setError(errorText(e)); setSaving(false); }
  }
  return <form className="form planning-form" onSubmit={submit}>
    <div className="planning-settlement-summary"><span>{row.plan.description}</span><strong>{formatMoney(row.amountCents)}</strong><small>Referência: {monthLabel(row.month)}</small></div>
    {!row.linkedEntry && candidates.length > 0 && <><div className="planning-link-choice" aria-label="Origem do registro"><button type="button" aria-pressed={mode === 'existing'} className={mode === 'existing' ? 'selected' : ''} onClick={() => { setMode('existing'); setError(''); }}>Vincular lançamento existente</button><button type="button" aria-pressed={mode === 'new'} className={mode === 'new' ? 'selected' : ''} onClick={() => { setMode('new'); setError(''); }}>Criar lançamento</button></div><p className="planning-field-help">Encontramos {candidates.length === 1 ? 'um lançamento compatível' : 'lançamentos compatíveis'} neste mês. Se este item já foi registrado, vincule-o para manter um único registro.</p></>}
    {mode === 'existing' ? <><label>Lançamento a vincular<select autoFocus required value={entryId} onChange={(event) => setEntryId(event.target.value)}>{candidates.map((entry) => <option key={entry.id} value={entry.id}>{entry.description} · {formatMoney(entry.amountCents)} · {dateLabel(entry.occurredOn)} · {entry.status === 'paid' ? income ? 'recebido' : 'pago' : 'pendente'}</option>)}</select></label>{selectedEntry && <div className="planning-form-context"><Info size={16} /><p>O planejamento usará o valor registrado de <strong>{formatMoney(selectedEntry.amountCents)}</strong>. {selectedEntry.status === 'paid' ? 'O registro já está liquidado; nenhum novo movimento será criado.' : 'O registro continuará pendente. Depois de vincular, você poderá confirmar o pagamento ou recebimento.'}</p></div>}</> : <><label>Data do {income ? 'recebimento' : 'pagamento'}<input autoFocus required type="date" max={localDate()} value={paidOn} onChange={(event) => { setPaidOn(event.target.value); setConfirmedDate(false); }} /></label><label>Conta do {income ? 'recebimento' : 'pagamento'}<select required value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="" disabled>Selecione uma conta</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>{outsideMonth && <label className="planning-date-confirm"><input required type="checkbox" checked={confirmedDate} onChange={(event) => setConfirmedDate(event.target.checked)} /><span>Confirmo que a data do {income ? 'recebimento' : 'pagamento'} está fora de {monthLabel(row.month)}. O orçamento permanece nesse mês e o dinheiro movimenta a conta na data informada.</span></label>}<p className="planning-field-help">{row.linkedEntry ? 'O lançamento já vinculado será liquidado, sem criar outro registro.' : 'Será criado um lançamento vinculado a este item do mês.'} Este registro atualiza o saldo da conta.</p></>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" className="button secondary" disabled={saving} onClick={onClose}>Cancelar</button><button type="submit" className="button primary" disabled={saving}><Check size={16} />{saving ? 'Registrando…' : mode === 'existing' ? 'Vincular lançamento' : row.linkedEntry ? income ? 'Confirmar recebimento' : 'Confirmar pagamento' : income ? 'Criar e registrar recebimento' : 'Criar e registrar pagamento'}</button></div>
  </form>;
}

function EndPlanForm({ plan, month, onClose, onSaved }: { plan: PlanItem; month: string; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); if (saving) return;
    setSaving(true); setError('');
    try { await deletePlan(plan.id, plan.version, month); onSaved(); }
    catch (e) { setError(errorText(e)); setSaving(false); }
  }
  return <form className="form planning-form" onSubmit={submit}>
    <p className="planning-confirm-copy">A previsão de <strong>{plan.description}</strong> será encerrada a partir de <strong>{monthLabel(month)}</strong>, incluindo esse mês.</p>
    <div className="planning-form-context"><Info size={17} /><p>O histórico dos meses anteriores e os lançamentos já registrados serão preservados. Esta ação não exclui pagamentos nem recebimentos.{plan.type === 'installment' && ' Encerrar a previsão não registra quitação, cancelamento ou estorno da compra no cartão.'}</p></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" className="button secondary" disabled={saving} onClick={onClose}>Manter previsão</button><button type="submit" className="button primary" disabled={saving}>{saving ? 'Encerrando…' : 'Encerrar previsão'}</button></div>
  </form>;
}

export default function PlanningPage({ month, onMonthChange, accounts, categories, entries, onNotify }: PlanningPageProps) {
  const [data, setData] = useState<PlanningSnapshot | null>(null);
  const [loadError, setLoadError] = useState('');
  const [editor, setEditor] = useState<PlanEditor | null>(null);
  const [settlement, setSettlement] = useState<PlanningRow | null>(null);
  const [ending, setEnding] = useState<PlanItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<PlanType>>(new Set());
  const [showInactive, setShowInactive] = useState(false);
  useEffect(() => {
    const subscription = liveQuery(getPlanningSnapshot).subscribe({
      next: (value) => { setData(value); setLoadError(''); },
      error: (error) => setLoadError(errorText(error)),
    });
    return () => subscription.unsubscribe();
  }, []);
  const rows = useMemo(() => data ? rowsForMonth(data.plans, data.occurrences, entries, month) : [], [data, entries, month]);
  const summary = useMemo(() => data ? monthlyPlanningSummary(data.plans, data.occurrences, entries, month) : null, [data, entries, month]);
  const entryMap = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const occurrenceMap = useMemo(() => new Map(data?.occurrences.filter((occurrence) => occurrence.month === month).map((occurrence) => [occurrence.planId, occurrence]) ?? []), [data, month]);
  const inactivePlans = data?.plans.filter((plan) => !rows.some((row) => row.plan.id === plan.id)) ?? [];
  const unlinkedIncome = entries.filter((entry) => entry.kind === 'income' && entry.occurredOn.startsWith(`${month}-`)
    && !entry.planId && !data?.occurrences.some((occurrence) => occurrence.linkedEntryId === entry.id));
  const hasPlans = Boolean(data?.plans.length);
  const budgetSegments = summary ? [
    { label: 'Contas fixas', cents: summary.fixedCents + summary.annualCents, className: 'fixed' },
    { label: 'Cartões e parcelas', cents: summary.cardFixedCents + summary.installmentCents, className: 'card' },
    { label: 'Reservas', cents: summary.reserveCents, className: 'reserve' },
    { label: 'Gastos variáveis', cents: summary.variableCents, className: 'variable' },
    { label: 'Disponível', cents: Math.max(0, summary.availableCents), className: 'available' },
  ] : [];
  const totalBar = Math.max(1, budgetSegments.reduce((sum, item) => sum + Math.max(0, item.cents), 0));

  function toggleGroup(type: PlanType) {
    setCollapsed((previous) => { const next = new Set(previous); if (next.has(type)) next.delete(type); else next.add(type); return next; });
  }
  async function toggleChecked(row: PlanningRow, checked: boolean) {
    if (busyId) return;
    setBusyId(row.plan.id);
    try {
      await setPlanningChecked(row.plan.id, month, checked);
      onNotify(row.plan.type === 'reserve' ? checked ? 'Reserva marcada como separada neste mês.' : 'Conferência da reserva desfeita.' : checked ? 'Item marcado como conferido na fatura.' : 'Conferência da fatura desfeita.');
    } catch (error) { onNotify(errorText(error), true); }
    finally { setBusyId(null); }
  }

  if (loadError) return <section className="panel planning-load-state" role="alert"><Info size={25} /><h2>Não foi possível abrir o planejamento</h2><p>{loadError}</p></section>;
  if (!data || !summary) return <section className="panel planning-load-state" aria-live="polite"><CalendarDays size={25} /><p>Abrindo seu planejamento…</p></section>;

  return <div className="planning-page">
    <div className="planning-toolbar"><div className="planning-period"><button type="button" className="icon-button" aria-label="Mês anterior do planejamento" disabled={month === '1900-01'} onClick={() => onMonthChange(offsetMonth(month, -1))}><ChevronLeft size={18} /></button><label><CalendarDays size={17} /><span>{monthLabel(month)}</span><input type="month" value={month} min="1900-01" max="9999-12" aria-label="Mês do planejamento" onChange={(event) => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) onMonthChange(event.target.value); }} /></label><button type="button" className="icon-button" aria-label="Próximo mês do planejamento" disabled={month === '9999-12'} onClick={() => onMonthChange(offsetMonth(month, 1))}><ChevronRight size={18} /></button></div><button type="button" className="button primary" onClick={() => setEditor({ type: 'fixed' })}><Plus size={17} />Adicionar item</button></div>

    <section className="planning-summary" aria-label="Resumo do orçamento mensal">
      <article className="planning-metric"><div><span>Receitas previstas</span><Banknote size={18} /></div><strong>{formatMoney(summary.expectedIncomeCents)}</strong><p>Salário e adiantamento previstos</p></article>
      <article className="planning-metric"><div><span>Compromissos do mês</span><Layers3 size={18} /></div><strong>{formatMoney(summary.committedCents - summary.variableCents)}</strong><p>Contas, cartões, parcelas e reservas</p></article>
      <article className="planning-metric"><div><span>Gastos variáveis</span><ReceiptText size={18} /></div><strong>{formatMoney(summary.variableCents)}</strong><p>Lançamentos fora das previsões</p></article>
      <article className={`planning-metric planning-available ${summary.availableCents < 0 ? 'is-negative' : ''}`}><div><span>{summary.availableCents < 0 ? 'Falta no orçamento' : 'Disponível no orçamento'}</span><Wallet size={18} /></div><strong>{formatMoney(summary.availableCents)}</strong><p>Receitas menos compromissos e variáveis</p></article>
    </section>

    {unlinkedIncome.length > 0 && <aside className="planning-unlinked-note"><Info size={16} /><p>Há <strong>{unlinkedIncome.length} {unlinkedIncome.length === 1 ? 'receita registrada' : 'receitas registradas'}</strong> em Lançamentos sem vínculo com o planejamento. Para incluí-las no orçamento, cadastre a previsão e escolha <strong>Vincular lançamento existente</strong> ao registrar o recebimento.</p><button type="button" onClick={() => setEditor({ type: 'salary' })}>Adicionar previsão</button></aside>}

    <section className="panel planning-composition" aria-labelledby="planning-composition-title"><div className="planning-composition-heading"><div><span className="eyebrow">SEU MÊS POR INTEIRO</span><h2 id="planning-composition-title">Cada valor com seu destino.</h2></div><span className="planning-forecast-badge"><CalendarDays size={13} />Orçamento previsto</span></div><div className="planning-budget-bar" role="img" aria-label={budgetSegments.filter((item) => item.cents > 0).map((item) => `${item.label}: ${formatMoney(item.cents)}`).join('; ') || 'Nenhum valor cadastrado no orçamento'}>{budgetSegments.filter((item) => item.cents > 0).map((item) => <span key={item.className} className={item.className} style={{ width: `${item.cents / totalBar * 100}%` }} title={`${item.label}: ${formatMoney(item.cents)}`} />)}</div><div className="planning-budget-legend">{budgetSegments.map((item) => <span key={item.className}><i className={item.className} /><span>{item.label}</span><strong>{formatMoney(item.cents)}</strong></span>)}</div><p className="planning-budget-note"><Info size={14} />O orçamento considera as previsões mesmo antes do pagamento. O saldo das contas muda somente com os registros realizados.</p></section>

    {!hasPlans && <section className="planning-welcome"><span className="planning-welcome-icon"><Sparkles size={27} strokeWidth={1.5} /></span><div><h2>Organize os próximos meses uma vez.</h2><p>Comece pelas suas receitas e contas fixas. Depois, acompanhe cartões, parcelas e o valor que deseja reservar.</p></div><button type="button" className="button light" onClick={() => setEditor({ type: 'salary' })}>Adicionar minha receita<ArrowRight size={16} /></button></section>}

    <div className="planning-groups">{GROUPS.map((group) => {
      const groupRows = rows.filter((row) => row.plan.type === group.type);
      const subtotal = groupRows.reduce((sum, row) => sum + row.amountCents, 0);
      const Icon = group.icon;
      const isCollapsed = collapsed.has(group.type);
      const shownPlanCount = data.plans.filter((plan) => plan.type === group.type).length;
      return <section className={`panel planning-group planning-group-${group.className}`} key={group.type} aria-labelledby={`planning-group-${group.type}`}>
        <div className="planning-group-header"><button type="button" className="planning-group-toggle" aria-expanded={!isCollapsed} aria-controls={`planning-rows-${group.type}`} onClick={() => toggleGroup(group.type)}><span className={`planning-group-icon ${group.className}`}><Icon size={19} /></span><span><h2 id={`planning-group-${group.type}`}>{group.title}</h2><small>{groupRows.length} {groupRows.length === 1 ? 'item neste mês' : 'itens neste mês'}</small></span><ChevronRight className={isCollapsed ? '' : 'is-open'} size={16} /></button><strong className="planning-subtotal">{formatMoney(subtotal)}</strong></div>
        <div id={`planning-rows-${group.type}`} hidden={isCollapsed}>
          <p className="planning-group-context">{group.subtitle}</p>
          {groupRows.length ? <ul className="planning-item-list">{groupRows.map((row) => {
            const occurrence = occurrenceMap.get(row.plan.id);
            const entry = row.linkedEntry ?? (occurrence?.linkedEntryId ? entryMap.get(occurrence.linkedEntryId) : undefined);
            const completed = isCashPlan(row.plan.type) ? entry?.status === 'paid' : occurrence?.status === 'done';
            const isPastDue = !completed && isCashPlan(row.plan.type) && row.dueOn < localDate();
            const actionLabel = row.plan.type === 'salary' ? 'Registrar recebimento' : isCashPlan(row.plan.type) ? 'Registrar pagamento' : row.plan.type === 'reserve' ? 'Separado' : 'Conferido na fatura';
            const completedLabel = row.plan.type === 'salary' ? 'Recebido' : isCashPlan(row.plan.type) ? 'Pago' : row.plan.type === 'reserve' ? 'Separado' : 'Conferido';
            return <li className="planning-item" key={`${row.plan.id}:${month}`}>
              <div className="planning-item-main"><div className="planning-item-name"><strong>{row.plan.description}</strong>{row.installmentNumber !== undefined && <span className="planning-parcel-badge">{row.installmentNumber}/{row.plan.totalInstallments}</span>}</div><div className="planning-item-detail"><span>{row.plan.type === 'salary' ? 'Receber' : row.plan.type === 'reserve' ? 'Separar' : 'Vence'} em {dateLabel(row.dueOn)}</span>{row.plan.cardName && <><i /><span>{row.plan.cardName}</span></>}{entry && <><i /><span>Registrado em lançamentos</span></>}</div>{row.plan.type === 'installment' && <div className="planning-installment-detail">{row.remainingAfterThisMonth !== undefined && <span>{row.remainingAfterThisMonth === 0 ? 'Última parcela prevista' : `${row.remainingAfterThisMonth} ${row.remainingAfterThisMonth === 1 ? 'parcela após este mês' : 'parcelas após este mês'}`}</span>}{row.futureBalanceCents !== undefined && row.futureBalanceCents > 0 && <span>Após a parcela deste mês: {formatMoney(row.futureBalanceCents)}</span>}{row.lastDueOn && <span>Última parcela prevista: {dateLabel(row.lastDueOn)} / {row.lastDueOn.slice(0, 4)}</span>}</div>}</div>
              <strong className="planning-item-amount">{formatMoney(row.amountCents)}</strong>
              <div className="planning-item-actions">{isCashPlan(row.plan.type) ? completed ? <span className="planning-done"><CheckCircle2 size={13} />{completedLabel}</span> : <button type="button" className={`planning-check-button ${isPastDue ? 'is-late' : ''}`} onClick={() => setSettlement(row)}><Check size={13} />{actionLabel}</button> : <button type="button" className={`planning-check-button ${completed ? 'is-checked' : ''}`} aria-pressed={Boolean(completed)} disabled={Boolean(busyId)} onClick={() => toggleChecked(row, !completed)}>{completed ? <CheckCircle2 size={13} /> : <span className="planning-empty-check" />}{busyId === row.plan.id ? 'Salvando…' : actionLabel}</button>}<div className="planning-edit-actions"><button type="button" className="icon-button" disabled={row.plan.archived} aria-label={`Editar previsão: ${row.plan.description}`} title={row.plan.archived ? 'Previsão encerrada; cadastre outra para retomar' : 'Editar previsão'} onClick={() => { const current = data.plans.find((plan) => plan.id === row.plan.id) ?? row.plan; setEditor({ plan: current, type: current.type }); }}><Pencil size={14} /></button>{!row.plan.archived && <button type="button" className="icon-button planning-end-button" aria-label={`Encerrar previsão: ${row.plan.description}`} title="Encerrar a partir deste mês" onClick={() => setEnding(row.plan)}><ArchiveX size={15} /></button>}</div></div>
            </li>;
          })}</ul> : <div className="planning-group-empty"><p>{shownPlanCount ? 'Nenhum vencimento previsto para este mês.' : group.empty}</p></div>}
          <div className="planning-group-footer"><button type="button" className="text-button" onClick={() => setEditor({ type: group.type })}><Plus size={14} />{group.addLabel}</button><span>{groupRows.length ? 'Total do mês' : 'Previsão mensal'}<strong>{formatMoney(subtotal)}</strong></span></div>
        </div>
      </section>;
    })}</div>

    {inactivePlans.length > 0 && <section className="panel planning-inactive"><button type="button" className="planning-inactive-toggle" aria-expanded={showInactive} aria-controls="planning-inactive-list" onClick={() => setShowInactive(!showInactive)}><Clock3 size={17} /><span>Outros itens cadastrados<strong>{inactivePlans.length}</strong></span><ChevronRight className={showInactive ? 'is-open' : ''} size={16} /></button>{showInactive && <div id="planning-inactive-list"><p>Itens futuros, encerrados ou sem vencimento no mês selecionado.</p>{inactivePlans.map((plan) => <div className="planning-inactive-row" key={plan.id}><span><strong>{plan.description}</strong><small>{GROUPS.find((group) => group.type === plan.type)?.title} · {plan.archived ? 'Previsão encerrada' : `Início em ${monthLabel(plan.startMonth)}`}</small></span><strong>{formatMoney(plan.amountCents)}</strong><button type="button" className="icon-button" disabled={plan.archived} title={plan.archived ? 'Previsão encerrada; cadastre outra para retomar' : 'Editar previsão'} aria-label={`Editar previsão: ${plan.description}`} onClick={() => setEditor({ plan, type: plan.type })}><Pencil size={14} /></button>{!plan.archived && <button type="button" className="icon-button planning-end-button" aria-label={`Encerrar previsão: ${plan.description}`} onClick={() => setEnding(plan)}><ArchiveX size={15} /></button>}</div>)}</div>}</section>}

    <p className="planning-bottom-note"><HardDrive size={14} />O planejamento é salvo no banco SQL da demonstração; alterações exigem conexão.</p>
    {editor && <PlanningDialog title={editor.plan ? 'Editar previsão' : 'Adicionar ao planejamento'} wide onClose={() => setEditor(null)}><PlanForm editor={editor} month={month} accounts={accounts} categories={categories} onClose={() => setEditor(null)} onSaved={(plan) => { setEditor(null); if (!editor.plan && plan.startMonth !== month) onMonthChange(plan.startMonth); onNotify(editor.plan ? 'Previsão atualizada. Registros realizados foram preservados.' : 'Item adicionado ao planejamento.'); }} /></PlanningDialog>}
    {settlement && <PlanningDialog title={settlement.plan.type === 'salary' ? 'Registrar recebimento' : 'Registrar pagamento'} onClose={() => setSettlement(null)}><SettlementForm row={settlement} accounts={accounts} candidates={entries.filter((entry) => entry.kind === (settlement.plan.type === 'salary' ? 'income' : 'expense') && entry.occurredOn.startsWith(`${month}-`) && !entry.planId && !data.occurrences.some((occurrence) => occurrence.linkedEntryId === entry.id)).sort((a, b) => Math.abs(a.amountCents - settlement.amountCents) - Math.abs(b.amountCents - settlement.amountCents) || a.occurredOn.localeCompare(b.occurredOn))} onClose={() => setSettlement(null)} onSaved={(result) => { const income = settlement.plan.type === 'salary'; setSettlement(null); onNotify(result === 'linked' ? 'Lançamento vinculado ao planejamento, sem criar duplicação.' : income ? 'Recebimento registrado e saldo atualizado.' : 'Pagamento registrado e saldo atualizado.'); }} /></PlanningDialog>}
    {ending && <PlanningDialog title="Encerrar previsão?" onClose={() => setEnding(null)}><EndPlanForm plan={ending} month={month} onClose={() => setEnding(null)} onSaved={() => { setEnding(null); onNotify('Previsão encerrada a partir deste mês. Histórico preservado.'); }} /></PlanningDialog>}
  </div>;
}
