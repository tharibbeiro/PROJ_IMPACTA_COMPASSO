// Gerado a partir de backend/ e shared/. Edite as fontes e execute npm run build.
function generateId_() { return Utilities.getUuid(); }
function cloneValue_(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
"use strict";
var CompassoBackend_ = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // backend/apps-script.ts
  var apps_script_exports = {};
  __export(apps_script_exports, {
    MAX_ACTIVE_SESSIONS: () => MAX_ACTIVE_SESSIONS,
    SPREADSHEET_PROPERTY: () => SPREADSHEET_PROPERTY,
    bootstrap: () => bootstrap,
    command: () => command,
    configurar: () => configurar,
    createAppsScriptController: () => createAppsScriptController,
    createDemoSession: () => createDemoSession
  });

  // backend/contracts.ts
  var AppError = class extends Error {
    constructor(message, status = 400) {
      super(message);
      __publicField(this, "status");
      this.name = "AppError";
      this.status = status;
    }
  };

  // shared/domain/finance.ts
  var brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  function localDate(date = /* @__PURE__ */ new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  function isValidDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month2, day] = value.split("-").map(Number);
    if (year < 1900 || year > 9999) return false;
    const date = new Date(Date.UTC(year, month2 - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month2 - 1 && date.getUTCDate() === day;
  }

  // shared/domain/planning.ts
  var types = ["salary", "fixed", "cardFixed", "installment", "annual", "reserve"];
  function isValidMonth(value) {
    return typeof value === "string" && /^(19\d{2}|[2-9]\d{3})-(0[1-9]|1[0-2])$/.test(value);
  }
  function monthIndex(month2) {
    if (!isValidMonth(month2)) throw new Error("Informe um mês válido no formato ano-mês.");
    const [year, number2] = month2.split("-").map(Number);
    return year * 12 + number2 - 1;
  }
  function addMonths(month2, count) {
    if (!Number.isSafeInteger(count)) throw new Error("A quantidade de meses é inválida.");
    const index = monthIndex(month2) + count;
    const year = Math.floor(index / 12);
    const number2 = index - year * 12 + 1;
    if (year < 1900 || year > 9999) throw new Error("A data calculada está fora do intervalo permitido.");
    return `${year}-${String(number2).padStart(2, "0")}`;
  }
  function dueDateForMonth(month2, dueDay) {
    monthIndex(month2);
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) throw new Error("O dia de vencimento deve estar entre 1 e 31.");
    const [year, number2] = month2.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, number2, 0)).getUTCDate();
    return `${month2}-${String(Math.min(dueDay, lastDay)).padStart(2, "0")}`;
  }
  function text(value, label, maximum, required = true) {
    if (value === void 0 || value === null || value === "") {
      if (required) throw new Error(`Informe ${label}.`);
      return void 0;
    }
    if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) {
      throw new Error(`${label}: use um texto de até ${maximum} caracteres.`);
    }
    return value.trim();
  }
  function validatePlanInput(input) {
    if (!input || typeof input !== "object" || !types.includes(input.type)) throw new Error("Escolha um tipo de planejamento válido.");
    const description = text(input.description, "a descrição", 160);
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new Error("O valor planejado deve ser maior que zero, em centavos inteiros.");
    if (!isValidMonth(input.startMonth)) throw new Error("Informe o mês inicial do planejamento.");
    if (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 31) throw new Error("O dia de vencimento deve estar entre 1 e 31.");
    const endMonth = text(input.endMonth, "o mês final", 7, false);
    if (endMonth && (!isValidMonth(endMonth) || endMonth < input.startMonth)) throw new Error("O mês final deve ser igual ou posterior ao mês inicial.");
    const bankItem = input.type === "salary" || input.type === "fixed" || input.type === "annual";
    const cardItem = input.type === "cardFixed" || input.type === "installment";
    const accountId = text(input.accountId, "a conta", 100, bankItem);
    const categoryId = text(input.categoryId, "a categoria", 100, bankItem);
    const cardName = text(input.cardName, "o nome do cartão", 80, cardItem);
    let installment = {};
    if (input.type === "installment") {
      const current = input.installmentNumber;
      const total = input.totalInstallments;
      if (!Number.isInteger(current) || !Number.isInteger(total) || current < 1 || total < 1 || total > 1200 || current > total) {
        throw new Error("Informe a parcela deste mês e o total de parcelas, entre 1 e 1.200.");
      }
      addMonths(input.startMonth, total - current);
      installment = { installmentNumber: current, totalInstallments: total };
    }
    return {
      type: input.type,
      description,
      amountCents: input.amountCents,
      startMonth: input.startMonth,
      dueDay: input.dueDay,
      ...endMonth ? { endMonth } : {},
      ...accountId ? { accountId } : {},
      ...categoryId ? { categoryId } : {},
      ...cardName ? { cardName } : {},
      ...installment
    };
  }
  function safeSum(values) {
    const total = values.reduce((sum, value) => sum + value, 0);
    if (!Number.isSafeInteger(total)) throw new Error("A soma dos valores ultrapassa o limite permitido.");
    return total;
  }
  function rowForPlan(plan, month2) {
    const row = { plan, month: month2, amountCents: plan.amountCents, dueOn: dueDateForMonth(month2, plan.dueDay) };
    if (plan.type === "installment") {
      const elapsed = monthIndex(month2) - monthIndex(plan.startMonth);
      const installmentNumber = plan.installmentNumber + elapsed;
      const remaining = Math.max(0, plan.totalInstallments - installmentNumber);
      const lastMonth = addMonths(month2, remaining);
      const futureBalanceCents = plan.amountCents * remaining;
      if (!Number.isSafeInteger(futureBalanceCents)) throw new Error("O saldo futuro das parcelas ultrapassa o limite permitido.");
      Object.assign(row, { installmentNumber, remainingAfterThisMonth: remaining, futureBalanceCents, lastDueOn: dueDateForMonth(lastMonth, plan.dueDay) });
    }
    return row;
  }
  function occurrencesForMonth(plans, month2) {
    const index = monthIndex(month2);
    return plans.filter((plan) => {
      const start = monthIndex(plan.startMonth);
      if (index < start || plan.endMonth && month2 > plan.endMonth) return false;
      if (plan.archived && (!plan.archivedFromMonth || month2 >= plan.archivedFromMonth)) return false;
      if (plan.type === "annual" && month2.slice(5) !== plan.startMonth.slice(5)) return false;
      if (plan.type === "installment" && plan.installmentNumber + index - start > plan.totalInstallments) return false;
      return true;
    }).map((plan) => rowForPlan(plan, month2)).sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.plan.description.localeCompare(b.plan.description, "pt-BR"));
  }
  function snapshotForRow(row) {
    return {
      type: row.plan.type,
      description: row.plan.description,
      amountCents: row.amountCents,
      dueOn: row.dueOn,
      ...row.plan.cardName ? { cardName: row.plan.cardName } : {},
      ...row.installmentNumber !== void 0 ? { installmentNumber: row.installmentNumber } : {},
      ...row.plan.totalInstallments !== void 0 ? { totalInstallments: row.plan.totalInstallments } : {},
      ...row.remainingAfterThisMonth !== void 0 ? { remainingAfterThisMonth: row.remainingAfterThisMonth } : {},
      ...row.futureBalanceCents !== void 0 ? { futureBalanceCents: row.futureBalanceCents } : {},
      ...row.lastDueOn ? { lastDueOn: row.lastDueOn } : {}
    };
  }
  function rowFromSnapshot(plan, occurrence) {
    const snapshot = occurrence.snapshot;
    const { cardName: _newCardName, ...currentPlan } = plan;
    return {
      plan: {
        ...currentPlan,
        type: snapshot.type,
        description: snapshot.description,
        amountCents: snapshot.amountCents,
        ...snapshot.cardName ? { cardName: snapshot.cardName } : {},
        ...snapshot.totalInstallments !== void 0 ? { totalInstallments: snapshot.totalInstallments } : {}
      },
      month: occurrence.month,
      amountCents: snapshot.amountCents,
      dueOn: snapshot.dueOn,
      ...snapshot.installmentNumber !== void 0 ? { installmentNumber: snapshot.installmentNumber } : {},
      ...snapshot.remainingAfterThisMonth !== void 0 ? { remainingAfterThisMonth: snapshot.remainingAfterThisMonth } : {},
      ...snapshot.futureBalanceCents !== void 0 ? { futureBalanceCents: snapshot.futureBalanceCents } : {},
      ...snapshot.lastDueOn ? { lastDueOn: snapshot.lastDueOn } : {},
      occurrence
    };
  }
  function linkedEntriesForMonth(plans, occurrences, entries, month2) {
    var _a, _b, _c, _d;
    const ids = new Set(plans.map((plan) => plan.id));
    const occurrenceByEntry = new Map(occurrences.filter((occurrence) => occurrence.month === month2 && occurrence.linkedEntryId).map((occurrence) => [occurrence.linkedEntryId, occurrence.planId]));
    const result = /* @__PURE__ */ new Map();
    for (const value of entries) {
      const entry = value;
      const id = entry.planId && entry.planMonth === month2 ? entry.planId : occurrenceByEntry.get(entry.id);
      if (!id || !ids.has(id)) continue;
      const plan = plans.find((item) => item.id === id);
      const type = (_c = (_b = (_a = occurrences.find((item) => item.planId === id && item.month === month2)) == null ? void 0 : _a.snapshot) == null ? void 0 : _b.type) != null ? _c : plan.type;
      if (type !== "salary" && type !== "fixed" && type !== "annual") continue;
      if (entry.kind !== (type === "salary" ? "income" : "expense")) continue;
      result.set(id, [...(_d = result.get(id)) != null ? _d : [], entry]);
    }
    return result;
  }
  function rowsForMonth(plans, occurrences, entries, month2) {
    var _a;
    monthIndex(month2);
    const rows = new Map(occurrencesForMonth(plans, month2).map((row) => [row.plan.id, row]));
    for (const occurrence of occurrences) {
      if (occurrence.month !== month2 || !occurrence.snapshot) continue;
      const plan = plans.find((item) => item.id === occurrence.planId);
      if (plan) rows.set(plan.id, rowFromSnapshot(plan, occurrence));
    }
    const linked = linkedEntriesForMonth(plans, occurrences, entries, month2);
    for (const [id, items] of linked) {
      const plan = plans.find((item) => item.id === id);
      const existing = (_a = rows.get(id)) != null ? _a : rowForPlan(plan, month2);
      const entry = items[0];
      rows.set(id, { ...existing, amountCents: safeSum(items.map((item) => item.amountCents)), dueOn: entry.dueOn, linkedEntry: entry });
    }
    return [...rows.values()].map((row) => ({ ...row, occurrence: occurrences.find((item) => item.planId === row.plan.id && item.month === month2) })).sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.plan.description.localeCompare(b.plan.description, "pt-BR"));
  }

  // backend/services/backup.ts
  var LIMITS = { bytes: 2e6, accounts: 20, categories: 100, entries: 1e3, plans: 1e3, occurrences: 12e3 };
  function object(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("A estrutura da cópia de segurança é inválida.");
    return value;
  }
  function text2(value, label, max = 160) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new AppError(`${label}: informe um texto de até ${max} caracteres.`);
    return value.trim();
  }
  function money(value, allowNegative = false) {
    return typeof value === "number" && Number.isSafeInteger(value) && (allowNegative || value > 0);
  }
  function timestamp(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && isValidDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
  }
  function version(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
  }
  function uniqueIds(items) {
    if (new Set(items.map((item) => item.id)).size !== items.length) throw new AppError("A cópia contém identificadores duplicados.");
  }
  function array(value, label, maximum, required = false) {
    if (!Array.isArray(value) || value.length > maximum || required && !value.length) {
      throw new AppError(`${label}: a cópia deve conter ${required ? "entre 1 e" : "até"} ${maximum} registros.`);
    }
    return value;
  }
  function parseSnapshot(value, plan, month2) {
    if (value === void 0) return void 0;
    const item = object(value);
    const bankItem = plan.type === "salary" || plan.type === "fixed" || plan.type === "annual";
    if (item.type !== plan.type || !money(item.amountCents) || !isValidDate(item.dueOn) || !bankItem && !item.dueOn.startsWith(`${month2}-`)) throw new AppError("A cópia contém uma previsão mensal registrada inválida.");
    const description = text2(item.description, "Descrição registrada");
    const cardName = item.cardName === void 0 ? void 0 : text2(item.cardName, "Cartão registrado", 80);
    if ((plan.type === "cardFixed" || plan.type === "installment") && !cardName) throw new AppError("A cópia contém uma previsão de cartão sem identificação.");
    const result = {
      type: plan.type,
      description,
      amountCents: item.amountCents,
      dueOn: item.dueOn,
      ...cardName ? { cardName } : {}
    };
    if (plan.type === "installment") {
      if (!Number.isInteger(item.installmentNumber) || !Number.isInteger(item.totalInstallments) || item.installmentNumber < 1 || item.totalInstallments > 1200 || item.installmentNumber > item.totalInstallments || !Number.isInteger(item.remainingAfterThisMonth) || item.remainingAfterThisMonth !== item.totalInstallments - item.installmentNumber || !money(item.futureBalanceCents, true) || item.futureBalanceCents !== item.amountCents * item.remainingAfterThisMonth || !isValidDate(item.lastDueOn) || item.lastDueOn.slice(0, 7) !== addMonths(month2, item.remainingAfterThisMonth)) {
        throw new AppError("A cópia contém parcelas registradas inválidas.");
      }
      Object.assign(result, {
        installmentNumber: item.installmentNumber,
        totalInstallments: item.totalInstallments,
        remainingAfterThisMonth: item.remainingAfterThisMonth,
        futureBalanceCents: item.futureBalanceCents,
        lastDueOn: item.lastDueOn
      });
    }
    return result;
  }
  function utf8ByteLength(value) {
    let bytes = 0;
    for (let index = 0; index < value.length; index++) {
      const code = value.codePointAt(index);
      bytes += code <= 127 ? 1 : code <= 2047 ? 2 : code <= 65535 ? 3 : 4;
      if (code > 65535) index++;
    }
    return bytes;
  }
  function parse(raw, today) {
    if (today !== void 0 && !isValidDate(today)) throw new AppError("A data de referência para a importação é inválida.");
    let parsed = raw;
    if (typeof raw === "string") {
      if (utf8ByteLength(raw) > LIMITS.bytes) throw new AppError("A cópia de segurança deve ter até 2 MB.");
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        throw new AppError("Não foi possível ler o arquivo JSON.");
      }
    }
    const backup = object(parsed);
    if (backup.application !== "compasso-academico" || backup.version !== 1 && backup.version !== 2) {
      throw new AppError("Importe somente uma cópia de demonstração do Compasso Acadêmico. Cópias do aplicativo pessoal não são aceitas.");
    }
    const accounts = array(backup.accounts, "Contas", LIMITS.accounts, true).map((value) => {
      const item = object(value);
      if (item.type !== "bank" && item.type !== "cash" || !money(item.openingBalanceCents, true) || !timestamp(item.createdAt)) throw new AppError("A cópia contém uma conta inválida.");
      return { id: text2(item.id, "Identificador", 100), name: text2(item.name, "Conta", 80), type: item.type, openingBalanceCents: item.openingBalanceCents, createdAt: item.createdAt };
    });
    const categories = array(backup.categories, "Categorias", LIMITS.categories, true).map((value) => {
      const item = object(value);
      if (item.kind !== "expense" && item.kind !== "income" || typeof item.color !== "string" || !/^#[0-9a-f]{6}$/i.test(item.color)) throw new AppError("A cópia contém uma categoria inválida.");
      return { id: text2(item.id, "Identificador", 100), name: text2(item.name, "Categoria", 80), kind: item.kind, color: item.color };
    });
    uniqueIds(accounts);
    uniqueIds(categories);
    const accountIds = new Set(accounts.map((account) => account.id));
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const entries = array(backup.entries, "Lançamentos", LIMITS.entries).map((value) => {
      var _a;
      const item = object(value);
      if (item.kind !== "expense" && item.kind !== "income" || !money(item.amountCents) || !isValidDate(item.occurredOn) || !isValidDate(item.dueOn) || item.status !== "pending" && item.status !== "paid" || !version(item.version) || !timestamp(item.createdAt) || !timestamp(item.updatedAt)) throw new AppError("A cópia contém um lançamento inválido.");
      if (item.status === "paid" && (!isValidDate(item.paidOn) || today !== void 0 && item.paidOn > today)) throw new AppError("A cópia contém uma data de pagamento ou recebimento inválida.");
      const accountId = text2(item.accountId, "Conta", 100);
      const categoryId = text2(item.categoryId, "Categoria", 100);
      if (!accountIds.has(accountId) || ((_a = categoryById.get(categoryId)) == null ? void 0 : _a.kind) !== item.kind) throw new AppError("A cópia contém um lançamento sem conta ou categoria compatível.");
      if (item.planId === void 0 !== (item.planMonth === void 0) || item.planMonth !== void 0 && !isValidMonth(item.planMonth)) throw new AppError("A cópia contém um vínculo de planejamento incompleto.");
      const planId = item.planId === void 0 ? void 0 : text2(item.planId, "Planejamento", 100);
      if (item.isCardPayment !== void 0 && typeof item.isCardPayment !== "boolean") throw new AppError("A identificação de pagamento de fatura é inválida.");
      if (item.isCardPayment && (item.kind !== "expense" || planId)) throw new AppError("O pagamento de fatura deve ser uma despesa sem vínculo com outro compromisso.");
      if (item.isExample !== void 0 && typeof item.isExample !== "boolean") throw new AppError("A cópia contém metadados inválidos.");
      return {
        id: text2(item.id, "Identificador", 100),
        description: text2(item.description, "Descrição"),
        kind: item.kind,
        amountCents: item.amountCents,
        accountId,
        categoryId,
        occurredOn: item.occurredOn,
        dueOn: item.dueOn,
        status: item.status,
        version: item.version,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        ...item.status === "paid" ? { paidOn: item.paidOn } : {},
        ...planId ? { planId, planMonth: item.planMonth } : {},
        ...item.isCardPayment ? { isCardPayment: true } : {},
        ...typeof item.isExample === "boolean" ? { isExample: item.isExample } : {}
      };
    });
    uniqueIds(entries);
    const plans = array(backup.version === 2 ? backup.plans : [], "Planejamentos", LIMITS.plans).map((value) => {
      var _a;
      const item = object(value);
      const clean = validatePlanInput(item);
      if (!version(item.version) || !timestamp(item.createdAt) || !timestamp(item.updatedAt) || item.archived !== void 0 && typeof item.archived !== "boolean" || item.archivedFromMonth !== void 0 && (!isValidMonth(item.archivedFromMonth) || item.archived !== true)) throw new AppError("A cópia contém um planejamento inválido.");
      if (clean.accountId && !accountIds.has(clean.accountId)) throw new AppError("O planejamento contém uma conta inexistente.");
      if (clean.categoryId && ((_a = categoryById.get(clean.categoryId)) == null ? void 0 : _a.kind) !== (clean.type === "salary" ? "income" : "expense")) throw new AppError("O planejamento contém uma categoria incompatível.");
      return {
        ...clean,
        id: text2(item.id, "Planejamento", 100),
        version: item.version,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        ...typeof item.archived === "boolean" ? { archived: item.archived } : {},
        ...typeof item.archivedFromMonth === "string" ? { archivedFromMonth: item.archivedFromMonth } : {}
      };
    });
    uniqueIds(plans);
    const planById = new Map(plans.map((plan) => [plan.id, plan]));
    const entryById = new Map(entries.map((entry) => [entry.id, entry]));
    const planEntryKeys = /* @__PURE__ */ new Set();
    for (const entry of entries) {
      if (!entry.planId) continue;
      const plan = planById.get(entry.planId);
      const key = `${entry.planId}:${entry.planMonth}`;
      if (!plan || !["salary", "fixed", "annual"].includes(plan.type) || entry.kind !== (plan.type === "salary" ? "income" : "expense") || planEntryKeys.has(key)) throw new AppError("A cópia contém um vínculo de planejamento inválido ou duplicado.");
      planEntryKeys.add(key);
    }
    const occurrenceKeys = /* @__PURE__ */ new Set();
    const occurrenceIds = /* @__PURE__ */ new Set();
    const linkedIds = /* @__PURE__ */ new Set();
    const occurrences = array(backup.version === 2 ? backup.occurrences : [], "Ocorrências", LIMITS.occurrences).map((value) => {
      const item = object(value);
      const suppliedId = text2(item.id, "Ocorrência", 120);
      const planId = text2(item.planId, "Planejamento", 100);
      const plan = planById.get(planId);
      if (!plan || !isValidMonth(item.month) || item.status !== "pending" && item.status !== "done" || !timestamp(item.updatedAt)) throw new AppError("A cópia contém uma ocorrência inválida.");
      const key = `${planId}:${item.month}`;
      if (occurrenceKeys.has(key) || occurrenceIds.has(suppliedId)) throw new AppError("A cópia contém ocorrências duplicadas.");
      occurrenceKeys.add(key);
      occurrenceIds.add(suppliedId);
      const linkedEntryId = item.linkedEntryId === void 0 ? void 0 : text2(item.linkedEntryId, "Lançamento", 100);
      if (linkedEntryId) {
        const entry = entryById.get(linkedEntryId);
        if (!entry || entry.planId !== planId || entry.planMonth !== item.month || linkedIds.has(linkedEntryId) || item.status !== (entry.status === "paid" ? "done" : "pending")) throw new AppError("A cópia contém um lançamento vinculado incompatível.");
        linkedIds.add(linkedEntryId);
      } else if (["salary", "fixed", "annual"].includes(plan.type) && item.status === "done") throw new AppError("A cópia contém pagamento sem lançamento correspondente.");
      const savedSnapshot = parseSnapshot(item.snapshot, plan, item.month);
      return {
        id: key,
        planId,
        month: item.month,
        status: item.status,
        updatedAt: item.updatedAt,
        ...linkedEntryId ? { linkedEntryId } : {},
        ...savedSnapshot ? { snapshot: savedSnapshot } : {}
      };
    });
    for (const entry of entries) {
      if (entry.planId && !linkedIds.has(entry.id)) throw new AppError("A cópia contém um lançamento sem ocorrência de planejamento.");
    }
    const rawSettings = object(backup.settings);
    if (rawSettings.id !== "preferences" || typeof rawSettings.displayName !== "string" || rawSettings.displayName.length > 60 || typeof rawSettings.exampleMode !== "boolean") throw new AppError("As preferências da cópia são inválidas.");
    const settings = { id: "preferences", displayName: rawSettings.displayName.trim(), exampleMode: false };
    return { accounts, categories, entries, settings, plans, occurrences };
  }
  function parseBackup(raw, today) {
    try {
      return parse(raw, today);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(error instanceof Error ? error.message : "A cópia de segurança é inválida.");
    }
  }

  // backend/services/finance-service.ts
  function object2(value, label = "Dados") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(`${label} inválidos.`, 400);
    return value;
  }
  function text3(value, label, max = 160) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new AppError(`${label}: informe um texto de até ${max} caracteres.`, 400);
    return value.trim();
  }
  function optionalId(value) {
    return value === void 0 ? void 0 : text3(value, "Identificador", 100);
  }
  function cents(value, negative = false) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || !negative && value <= 0) throw new AppError("Informe um valor válido em centavos inteiros.", 400);
    return value;
  }
  function month(value) {
    if (!isValidMonth(value)) throw new AppError("Selecione um mês válido para o planejamento.", 400);
    return value;
  }
  function requireVersion(actual, expected) {
    if (actual !== expected) throw new AppError("Este registro foi alterado. Atualize os dados antes de salvar novamente.", 409);
  }
  function bankPlan(plan) {
    return plan.type === "salary" || plan.type === "fixed" || plan.type === "annual";
  }
  function nextVersion(current = 0) {
    if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) throw new AppError("A versão deste registro ultrapassa o limite permitido.", 400);
    return current + 1;
  }
  var FinanceService = class {
    constructor(clock = () => /* @__PURE__ */ new Date()) {
      this.clock = clock;
    }
    apply(original, command2) {
      var _a;
      const state = cloneValue_(original);
      try {
        const payload = object2(command2.payload, "Parâmetros");
        let result;
        switch (command2.type) {
          case "saveEntry":
            result = this.saveEntry(state, payload.input, optionalId(payload.id), payload.expectedVersion);
            break;
          case "settleEntry":
            result = this.settleEntry(state, text3(payload.id, "Lançamento", 100), payload.expectedVersion);
            break;
          case "deleteEntry":
            result = this.deleteEntry(state, text3(payload.id, "Lançamento", 100), payload.expectedVersion);
            break;
          case "addAccount":
            result = this.addAccount(state, payload.input);
            break;
          case "updateAccount":
            result = this.updateAccount(state, text3(payload.id, "Conta", 100), payload.input);
            break;
          case "addCategory":
            result = this.addCategory(state, payload.input);
            break;
          case "savePreferences":
            result = this.savePreferences(state, payload.input);
            break;
          case "restoreBackup": {
            const restored = parseBackup(payload.raw, this.today());
            this.checkLimits(restored);
            return { state: restored, result: void 0 };
          }
          case "savePlan": {
            const plan = this.savePlan(state, payload.input, optionalId(payload.id), payload.expectedVersion);
            if (payload.completion !== void 0) this.applyPlanCompletion(state, plan, payload.completion);
            result = plan;
            break;
          }
          case "deletePlan":
            result = this.deletePlan(state, text3(payload.id, "Planejamento", 100), payload.expectedVersion, month((_a = payload.fromMonth) != null ? _a : this.today().slice(0, 7)));
            break;
          case "realizePlan":
            result = this.realizePlan(state, text3(payload.planId, "Planejamento", 100), month(payload.month));
            break;
          case "settlePlan":
            result = this.settlePlan(state, text3(payload.planId, "Planejamento", 100), month(payload.month), payload.options === void 0 ? {} : object2(payload.options, "Pagamento"));
            break;
          case "setPlanningChecked":
            result = this.setPlanningChecked(state, text3(payload.planId, "Planejamento", 100), month(payload.month), payload.checked);
            break;
          case "linkPlanEntry":
            result = this.linkPlanEntry(state, text3(payload.planId, "Planejamento", 100), month(payload.month), text3(payload.entryId, "Lançamento", 100), payload.expectedVersion);
            break;
          case "clearEntries": {
            for (const entry of state.entries) this.writeOccurrence(state, entry, true);
            state.entries = [];
            result = void 0;
            break;
          }
          default:
            throw new AppError("Comando financeiro não reconhecido.", 400);
        }
        this.checkLimits(state);
        return { state, result: cloneValue_(result) };
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(error instanceof Error ? error.message : "Não foi possível aplicar o comando financeiro.", 400);
      }
    }
    now() {
      return this.clock().toISOString();
    }
    today() {
      return localDate(this.clock());
    }
    checkLimits(state) {
      if (state.accounts.length > 20 || state.categories.length > 100 || state.entries.length > 1e3 || state.plans.length > 1e3 || state.occurrences.length > 12e3) throw new AppError("O limite de registros desta demonstração foi atingido. Reinicie a demonstração para continuar.", 400);
      let total = 0;
      const values = [...state.accounts.map((item) => item.openingBalanceCents), ...state.entries.map((item) => item.amountCents), ...state.plans.map((item) => item.amountCents)];
      for (const value of values) {
        const amount = Math.abs(value);
        if (!Number.isSafeInteger(amount) || amount > Number.MAX_SAFE_INTEGER - total) {
          throw new AppError("A soma dos valores ultrapassa o limite seguro da demonstração.", 400);
        }
        total += amount;
      }
      for (const plan of state.plans) {
        if (plan.type === "installment" && !Number.isSafeInteger(plan.amountCents * (plan.totalInstallments - plan.installmentNumber))) throw new AppError("O saldo futuro das parcelas ultrapassa o limite permitido.", 400);
      }
    }
    account(state, id) {
      const account = state.accounts.find((item) => item.id === id);
      if (!account) throw new AppError("A conta selecionada não foi encontrada.", 404);
      return account;
    }
    plan(state, id) {
      const plan = state.plans.find((item) => item.id === id);
      if (!plan) throw new AppError("O compromisso do planejamento não foi encontrado.", 404);
      return plan;
    }
    inputEntry(raw) {
      const input = object2(raw, "Lançamento");
      if (input.kind !== "expense" && input.kind !== "income") throw new AppError("Escolha receita ou despesa.", 400);
      if (!isValidDate(input.occurredOn) || !isValidDate(input.dueOn)) throw new AppError("Informe datas válidas para o lançamento e o vencimento.", 400);
      if (input.status !== "pending" && input.status !== "paid") throw new AppError("A situação do lançamento é inválida.", 400);
      if (input.status === "paid" && (!isValidDate(input.paidOn) || input.paidOn > this.today())) throw new AppError("Informe uma data de pagamento ou recebimento válida, até hoje.", 400);
      if (input.planId === void 0 !== (input.planMonth === void 0)) throw new AppError("O vínculo com o planejamento está incompleto.", 400);
      if (input.planMonth !== void 0 && !isValidMonth(input.planMonth)) throw new AppError("O mês do planejamento é inválido.", 400);
      if (input.isCardPayment !== void 0 && typeof input.isCardPayment !== "boolean") throw new AppError("A identificação de pagamento de fatura é inválida.", 400);
      if (input.isCardPayment && (input.kind !== "expense" || input.planId)) throw new AppError("O pagamento de fatura deve ser uma despesa bancária sem vínculo com outro compromisso.", 400);
      return {
        description: text3(input.description, "Descrição"),
        kind: input.kind,
        amountCents: cents(input.amountCents),
        categoryId: text3(input.categoryId, "Categoria", 100),
        accountId: text3(input.accountId, "Conta", 100),
        occurredOn: input.occurredOn,
        dueOn: input.dueOn,
        status: input.status,
        ...input.status === "paid" ? { paidOn: input.paidOn } : {},
        ...input.planId !== void 0 ? { planId: text3(input.planId, "Planejamento", 100), planMonth: input.planMonth } : {},
        ...input.isCardPayment ? { isCardPayment: true } : {}
      };
    }
    saveEntry(state, raw, id, expectedVersion) {
      var _a, _b, _c, _d;
      const input = object2(raw, "Lançamento");
      const clean = this.inputEntry(input);
      this.account(state, clean.accountId);
      const category = state.categories.find((item) => item.id === clean.categoryId);
      if (!category || category.kind !== clean.kind) throw new AppError("Escolha uma categoria compatível com o tipo do lançamento.", 400);
      const existing = id ? state.entries.find((entry2) => entry2.id === id) : void 0;
      if (id && !existing) throw new AppError("O lançamento não foi encontrado.", 404);
      if (existing) requireVersion(existing.version, expectedVersion);
      if ((existing == null ? void 0 : existing.planId) && clean.planId && (existing.planId !== clean.planId || existing.planMonth !== clean.planMonth)) throw new AppError("O vínculo de um lançamento com o planejamento não pode ser trocado.", 400);
      const planId = (_a = existing == null ? void 0 : existing.planId) != null ? _a : clean.planId;
      const planMonth = (_b = existing == null ? void 0 : existing.planMonth) != null ? _b : clean.planMonth;
      const isCardPayment = input.isCardPayment === void 0 ? existing == null ? void 0 : existing.isCardPayment : input.isCardPayment;
      if (isCardPayment && (clean.kind !== "expense" || planId)) throw new AppError("O pagamento de fatura deve ser uma despesa bancária sem vínculo com outro compromisso.", 400);
      if (planId) {
        const plan = this.plan(state, planId);
        if (!bankPlan(plan) || clean.kind !== (plan.type === "salary" ? "income" : "expense")) throw new AppError("O planejamento vinculado ao lançamento é inválido.", 400);
        if (state.entries.some((entry2) => entry2.id !== id && entry2.planId === planId && entry2.planMonth === planMonth)) throw new AppError("Este compromisso já possui um lançamento vinculado no mês.", 409);
      }
      const entry = {
        ...clean,
        id: (_c = existing == null ? void 0 : existing.id) != null ? _c : generateId_(),
        version: nextVersion(existing == null ? void 0 : existing.version),
        createdAt: (_d = existing == null ? void 0 : existing.createdAt) != null ? _d : this.now(),
        updatedAt: this.now(),
        ...(existing == null ? void 0 : existing.isExample) ? { isExample: true } : {},
        ...planId ? { planId, planMonth } : {},
        ...isCardPayment ? { isCardPayment: true } : {}
      };
      if (existing) state.entries[state.entries.indexOf(existing)] = entry;
      else state.entries.push(entry);
      this.writeOccurrence(state, entry);
      return entry;
    }
    writeOccurrence(state, entry, removeLink = false) {
      var _a;
      if (!entry.planId || !entry.planMonth) return;
      const plan = this.plan(state, entry.planId);
      const previous = state.occurrences.find((item) => item.planId === entry.planId && item.month === entry.planMonth);
      const occurrence = {
        id: `${entry.planId}:${entry.planMonth}`,
        planId: entry.planId,
        month: entry.planMonth,
        status: !removeLink && entry.status === "paid" ? "done" : "pending",
        updatedAt: this.now(),
        snapshot: (_a = previous == null ? void 0 : previous.snapshot) != null ? _a : { type: plan.type, description: entry.description, amountCents: entry.amountCents, dueOn: entry.dueOn },
        ...!removeLink ? { linkedEntryId: entry.id } : {}
      };
      if (previous) state.occurrences[state.occurrences.indexOf(previous)] = occurrence;
      else state.occurrences.push(occurrence);
    }
    settleEntry(state, id, expectedVersion) {
      const entry = state.entries.find((item) => item.id === id);
      if (!entry) throw new AppError("O lançamento não foi encontrado.", 404);
      if (entry.status === "paid") return entry;
      requireVersion(entry.version, expectedVersion);
      return this.saveEntry(state, { ...entry, status: "paid", paidOn: this.today() }, id, entry.version);
    }
    deleteEntry(state, id, expectedVersion) {
      const entry = state.entries.find((item) => item.id === id);
      if (!entry) return;
      requireVersion(entry.version, expectedVersion);
      this.writeOccurrence(state, entry, true);
      state.entries = state.entries.filter((item) => item.id !== id);
    }
    accountInput(raw) {
      const input = object2(raw, "Conta");
      if (input.type !== "bank" && input.type !== "cash") throw new AppError("Escolha um tipo de conta válido.", 400);
      return { name: text3(input.name, "Nome da conta", 80), type: input.type, openingBalanceCents: cents(input.openingBalanceCents, true) };
    }
    addAccount(state, raw) {
      const account = { ...this.accountInput(raw), id: generateId_(), createdAt: this.now() };
      state.accounts.push(account);
      return account;
    }
    updateAccount(state, id, raw) {
      const existing = this.account(state, id);
      const account = { ...existing, ...this.accountInput(raw) };
      state.accounts[state.accounts.indexOf(existing)] = account;
      return account;
    }
    addCategory(state, raw) {
      const input = object2(raw, "Categoria");
      const name = text3(input.name, "Nome da categoria", 80);
      if (input.kind !== "expense" && input.kind !== "income") throw new AppError("Escolha receita ou despesa para a categoria.", 400);
      if (typeof input.color !== "string" || !/^#[0-9a-f]{6}$/i.test(input.color)) throw new AppError("Escolha uma cor válida para a categoria.", 400);
      if (state.categories.some((category2) => category2.kind === input.kind && category2.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) throw new AppError("Já existe uma categoria com esse nome e tipo.", 409);
      const category = { id: generateId_(), name, kind: input.kind, color: input.color };
      state.categories.push(category);
      return category;
    }
    savePreferences(state, raw) {
      const input = object2(raw, "Preferências");
      if (typeof input.displayName !== "string" || input.displayName.trim().length > 60) throw new AppError("O nome deve ter até 60 caracteres.", 400);
      state.settings = { ...state.settings, displayName: input.displayName.trim(), exampleMode: false };
    }
    savePlan(state, raw, id, expectedVersion) {
      var _a, _b, _c;
      const clean = validatePlanInput(object2(raw, "Planejamento"));
      if (clean.accountId) this.account(state, clean.accountId);
      if (clean.categoryId && ((_a = state.categories.find((item) => item.id === clean.categoryId)) == null ? void 0 : _a.kind) !== (clean.type === "salary" ? "income" : "expense")) throw new AppError("Escolha uma categoria compatível com o planejamento.", 400);
      const existing = id ? this.plan(state, id) : void 0;
      if (existing) requireVersion(existing.version, expectedVersion);
      if (existing == null ? void 0 : existing.archived) throw new AppError("Este compromisso foi encerrado. Cadastre outro para iniciar uma nova previsão.", 409);
      if (existing && existing.type !== clean.type && state.occurrences.some((item) => item.planId === id)) throw new AppError("Um compromisso com registros mensais não pode mudar de tipo. Cadastre outro compromisso.", 400);
      const plan = { ...clean, id: (_b = existing == null ? void 0 : existing.id) != null ? _b : generateId_(), version: nextVersion(existing == null ? void 0 : existing.version), createdAt: (_c = existing == null ? void 0 : existing.createdAt) != null ? _c : this.now(), updatedAt: this.now() };
      if (existing) state.plans[state.plans.indexOf(existing)] = plan;
      else state.plans.push(plan);
      return plan;
    }
    applyPlanCompletion(state, plan, raw) {
      const completion = object2(raw, "Confirmação do planejamento");
      const selectedMonth = month(completion.month);
      if (typeof completion.completed !== "boolean") throw new AppError("Informe se o item já foi concluído.", 400);
      if (!rowsForMonth([plan], state.occurrences, state.entries, selectedMonth).length) {
        throw new AppError("Este compromisso não possui previsão no mês da confirmação.", 400);
      }
      if (!bankPlan(plan)) {
        if (completion.paidOn !== void 0 || completion.expectedEntryVersion !== void 0) {
          throw new AppError("Itens de cartão e reservas são conferidos sem registrar pagamento bancário.", 400);
        }
        this.setPlanningChecked(state, plan.id, selectedMonth, completion.completed);
        return;
      }
      const paidOn = completion.paidOn;
      if (completion.completed && (!isValidDate(paidOn) || paidOn > this.today())) {
        throw new AppError("Informe uma data de pagamento ou recebimento válida, até hoje.", 400);
      }
      if (!completion.completed && paidOn !== void 0) throw new AppError("Um item pendente não deve informar data de pagamento.", 400);
      const entry = this.findPlanEntry(state, plan.id, selectedMonth);
      if (!entry) {
        if (completion.expectedEntryVersion !== void 0) throw new AppError("O lançamento vinculado foi alterado. Atualize os dados antes de continuar.", 409);
        if (completion.completed) this.settlePlan(state, plan.id, selectedMonth, { paidOn });
        return;
      }
      requireVersion(entry.version, completion.expectedEntryVersion);
      const status = completion.completed ? "paid" : "pending";
      if (entry.status === status && (!completion.completed || entry.paidOn === paidOn)) return;
      this.saveEntry(state, { ...entry, status, ...completion.completed ? { paidOn } : {} }, entry.id, entry.version);
    }
    deletePlan(state, id, expectedVersion, fromMonth) {
      const plan = this.plan(state, id);
      requireVersion(plan.version, expectedVersion);
      if (plan.archived && plan.archivedFromMonth && plan.archivedFromMonth <= fromMonth) return plan;
      const archived = { ...plan, archived: true, archivedFromMonth: fromMonth, version: nextVersion(plan.version), updatedAt: this.now() };
      state.plans[state.plans.indexOf(plan)] = archived;
      return archived;
    }
    findPlanEntry(state, planId, selectedMonth) {
      var _a;
      const occurrence = state.occurrences.find((item) => item.planId === planId && item.month === selectedMonth);
      const entry = (_a = state.entries.find((item) => item.id === (occurrence == null ? void 0 : occurrence.linkedEntryId))) != null ? _a : state.entries.find((item) => item.planId === planId && item.planMonth === selectedMonth);
      if (entry) this.writeOccurrence(state, entry);
      return entry;
    }
    realizePlan(state, planId, selectedMonth) {
      const plan = this.plan(state, planId);
      if (!bankPlan(plan)) throw new AppError("Itens de cartão e reservas são conferidos no planejamento e não criam despesas bancárias.", 400);
      const existing = this.findPlanEntry(state, planId, selectedMonth);
      if (existing) return existing;
      const row = rowsForMonth([plan], state.occurrences, state.entries, selectedMonth)[0];
      if (!row) throw new AppError("Este compromisso não possui previsão no mês selecionado.", 400);
      return this.saveEntry(state, { description: row.plan.description, kind: plan.type === "salary" ? "income" : "expense", amountCents: row.amountCents, categoryId: plan.categoryId, accountId: plan.accountId, occurredOn: row.dueOn, dueOn: row.dueOn, status: "pending", planId, planMonth: selectedMonth });
    }
    settlePlan(state, planId, selectedMonth, options) {
      var _a, _b;
      const paidOn = (_a = options.paidOn) != null ? _a : this.today();
      if (!isValidDate(paidOn) || paidOn > this.today()) throw new AppError("Informe uma data de pagamento ou recebimento válida, até hoje.", 400);
      const entry = this.realizePlan(state, planId, selectedMonth);
      if (entry.status === "paid") return entry;
      return this.saveEntry(state, { ...entry, status: "paid", paidOn, accountId: (_b = options.accountId) != null ? _b : entry.accountId }, entry.id, entry.version);
    }
    setPlanningChecked(state, planId, selectedMonth, checked) {
      var _a;
      if (typeof checked !== "boolean") throw new AppError("Informe uma situação válida para o compromisso.", 400);
      const plan = this.plan(state, planId);
      if (bankPlan(plan)) throw new AppError("Receitas e contas devem ser registradas ou pagas por um lançamento vinculado.", 400);
      const previous = state.occurrences.find((item) => item.planId === planId && item.month === selectedMonth);
      const row = rowsForMonth([plan], previous ? [previous] : [], [], selectedMonth)[0];
      if (!row) throw new AppError("Este compromisso não possui previsão no mês selecionado.", 400);
      const occurrence = { id: `${planId}:${selectedMonth}`, planId, month: selectedMonth, status: checked ? "done" : "pending", updatedAt: this.now(), snapshot: (_a = previous == null ? void 0 : previous.snapshot) != null ? _a : snapshotForRow(row) };
      if (previous) state.occurrences[state.occurrences.indexOf(previous)] = occurrence;
      else state.occurrences.push(occurrence);
      return occurrence;
    }
    linkPlanEntry(state, planId, selectedMonth, entryId, expectedVersion) {
      const plan = this.plan(state, planId);
      if (!bankPlan(plan)) throw new AppError("Somente receitas e contas bancárias podem ser vinculadas a um lançamento.", 400);
      if (!rowsForMonth([plan], state.occurrences, state.entries, selectedMonth).length) throw new AppError("Este compromisso não possui previsão no mês selecionado.", 400);
      const entry = state.entries.find((item) => item.id === entryId);
      if (!entry) throw new AppError("O lançamento selecionado não foi encontrado.", 404);
      if (expectedVersion !== void 0) requireVersion(entry.version, expectedVersion);
      if (entry.kind !== (plan.type === "salary" ? "income" : "expense") || !entry.occurredOn.startsWith(`${selectedMonth}-`)) throw new AppError("Escolha um lançamento do mesmo tipo e mês do planejamento.", 400);
      if (entry.planId && (entry.planId !== planId || entry.planMonth !== selectedMonth)) throw new AppError("Este lançamento já pertence a outro compromisso do planejamento.", 409);
      const current = this.findPlanEntry(state, planId, selectedMonth);
      if (current && current.id !== entryId) throw new AppError("Este compromisso já possui outro lançamento vinculado no mês.", 409);
      if (entry.planId === planId && entry.planMonth === selectedMonth) return entry;
      return this.saveEntry(state, { ...entry, planId, planMonth: selectedMonth }, entry.id, entry.version);
    }
  };

  // backend/services/demo-state.ts
  function createDemoState(now = /* @__PURE__ */ new Date()) {
    const today = localDate(now);
    const selectedMonth = today.slice(0, 7);
    const currentDay = Number(today.slice(8));
    const timestamp2 = now.toISOString();
    let state = {
      accounts: [
        { id: "demo-main", name: "Conta de demonstração", type: "bank", openingBalanceCents: 126e3, createdAt: timestamp2 },
        { id: "demo-wallet", name: "Carteira fictícia", type: "cash", openingBalanceCents: 18500, createdAt: timestamp2 }
      ],
      categories: [
        { id: "expense-food", name: "Alimentação", kind: "expense", color: "#df9658" },
        { id: "expense-home", name: "Moradia", kind: "expense", color: "#668c79" },
        { id: "expense-transport", name: "Transporte", kind: "expense", color: "#7297b1" },
        { id: "expense-health", name: "Saúde", kind: "expense", color: "#b186a3" },
        { id: "expense-leisure", name: "Lazer", kind: "expense", color: "#bda05c" },
        { id: "expense-subscriptions", name: "Assinaturas", kind: "expense", color: "#8c87af" },
        { id: "expense-other", name: "Outros gastos", kind: "expense", color: "#87928e" },
        { id: "income-salary", name: "Salário", kind: "income", color: "#287461" },
        { id: "income-extra", name: "Renda extra", kind: "income", color: "#6a9475" }
      ],
      entries: [],
      plans: [],
      occurrences: [],
      settings: { id: "preferences", displayName: "Demonstração", exampleMode: false }
    };
    const service = new FinanceService(() => new Date(now));
    const run = (type, payload) => {
      const applied = service.apply(state, { id: generateId_(), type, payload });
      state = applied.state;
      return applied.result;
    };
    const plan = (input) => run("savePlan", { input });
    const main = { accountId: "demo-main", startMonth: selectedMonth };
    const salary = plan({ ...main, type: "salary", description: "Salário fictício", amountCents: 51e4, dueDay: 5, categoryId: "income-salary" });
    const advance = plan({ ...main, type: "salary", description: "Adiantamento fictício", amountCents: 127500, dueDay: 20, categoryId: "income-salary" });
    const rent = plan({ ...main, type: "fixed", description: "Aluguel de demonstração", amountCents: 142e3, dueDay: 10, categoryId: "expense-home" });
    const internet = plan({ ...main, type: "fixed", description: "Internet de demonstração", amountCents: 11290, dueDay: 15, categoryId: "expense-home" });
    const energy = plan({ ...main, type: "fixed", description: "Energia estimada", amountCents: 18550, dueDay: 28, categoryId: "expense-home" });
    const subscription = plan({ type: "cardFixed", description: "Assinatura de música", amountCents: 2190, startMonth: selectedMonth, dueDay: 18, cardName: "Cartão fictício" });
    plan({ type: "installment", description: "Notebook de demonstração", amountCents: 24390, startMonth: selectedMonth, dueDay: 18, cardName: "Cartão fictício", installmentNumber: 5, totalInstallments: 12 });
    plan({ ...main, type: "annual", description: "Seguro anual fictício", amountCents: 94900, startMonth: addMonths(selectedMonth, 2), dueDay: 25, categoryId: "expense-other" });
    const reserve = plan({ type: "reserve", description: "Reserva para estudos", amountCents: 35e3, startMonth: selectedMonth, dueDay: 25 });
    for (const item of [salary, advance, rent, internet, energy]) {
      if (item !== energy && currentDay >= item.dueDay) {
        run("settlePlan", { planId: item.id, month: selectedMonth, options: { paidOn: `${selectedMonth}-${String(item.dueDay).padStart(2, "0")}` } });
      } else {
        run("realizePlan", { planId: item.id, month: selectedMonth });
      }
    }
    run("setPlanningChecked", { planId: subscription.id, month: selectedMonth, checked: true });
    if (currentDay >= 10) run("setPlanningChecked", { planId: reserve.id, month: selectedMonth, checked: true });
    for (const item of [
      { description: "Mercado fictício", amountCents: 28740, categoryId: "expense-food", accountId: "demo-main" },
      { description: "Transporte de demonstração", amountCents: 6490, categoryId: "expense-transport", accountId: "demo-main" },
      { description: "Lanche de demonstração", amountCents: 1850, categoryId: "expense-food", accountId: "demo-wallet" }
    ]) {
      run("saveEntry", { input: { ...item, kind: "expense", occurredOn: today, dueOn: today, status: "paid", paidOn: today } });
    }
    return state;
  }

  // backend/repositories/apps-script-sheet-port.ts
  function literalCell(value) {
    return typeof value === "string" && /^[\s\ufeff]*[=+\-@']/.test(value) ? `'${value}` : value;
  }
  var AppsScriptSheetPort = class {
    constructor(spreadsheet, flushWrites = () => {
    }) {
      this.spreadsheet = spreadsheet;
      this.flushWrites = flushWrites;
      __publicField(this, "cache", /* @__PURE__ */ new Map());
    }
    flush() {
      try {
        this.flushWrites();
      } catch (error) {
        this.cache.clear();
        throw error;
      }
    }
    read(name, options = {}) {
      var _a, _b;
      if (options.fresh) this.cache.delete(name);
      const state = this.sheet(name);
      if (!state.values) {
        const rows = (_a = state.lastRow) != null ? _a : state.lastRow = state.sheet.getLastRow();
        const columns = (_b = state.lastColumn) != null ? _b : state.lastColumn = state.sheet.getLastColumn();
        state.values = !rows || !columns ? [] : state.sheet.getRange(1, 1, rows, columns).getValues().map((row) => row.map((value) => {
          if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw new AppError("A planilha contém um valor incompatível. Preserve as datas e os identificadores como texto.", 503);
          return value;
        }));
      }
      return state.values.map((row) => [...row]);
    }
    append(name, rows) {
      if (!rows.length) return;
      const columns = rows[0].length;
      if (!columns || rows.some((row) => row.length !== columns)) throw new AppError("As linhas da planilha possuem formatos incompatíveis.", 500);
      this.mutate(name, (state) => {
        var _a;
        const start = ((_a = state.lastRow) != null ? _a : state.lastRow = state.sheet.getLastRow()) + 1;
        this.capacity(state, start + rows.length - 1, columns);
        const range = state.sheet.getRange(start, 1, rows.length, columns);
        range.setNumberFormat("@");
        range.setValues(rows.map((row) => row.map(literalCell)));
        if (state.values) {
          state.values.push(...rows.map((row) => [...row]));
          this.normalize(state);
        } else {
          state.lastRow = void 0;
          state.lastColumn = void 0;
        }
      });
    }
    replaceCell(name, row, column, value) {
      this.mutate(name, (state) => {
        this.capacity(state, row, column);
        const range = state.sheet.getRange(row, column, 1, 1);
        range.setNumberFormat("@");
        range.setValues([[literalCell(value)]]);
        if (state.values) {
          while (state.values.length < row) state.values.push([]);
          state.values[row - 1][column - 1] = value;
          this.normalize(state);
        } else {
          state.lastRow = void 0;
          state.lastColumn = void 0;
        }
      });
    }
    ensureSheet(name, headers) {
      var _a;
      if (!this.cache.has(name)) {
        const sheet = (_a = this.spreadsheet.getSheetByName(name)) != null ? _a : this.spreadsheet.insertSheet(name);
        this.cache.set(name, { sheet });
      }
      const values = this.read(name);
      if (!values.length) {
        this.append(name, [[...headers]]);
        return;
      }
      const actual = values[0];
      if (headers.some((header, index) => actual[index] !== header)) throw new AppError(`Os cabeçalhos da aba ${name} foram alterados. Restaure a estrutura configurada antes de continuar.`, 503);
    }
    deleteRows(name, row, count) {
      if (row < 2 || !Number.isInteger(row) || !Number.isInteger(count) || count < 1) throw new AppError("A limpeza da planilha recebeu linhas inválidas.", 500);
      this.mutate(name, (state) => {
        state.sheet.deleteRows(row, count);
        if (state.maxRows !== void 0) state.maxRows -= count;
        if (state.values) {
          state.values.splice(row - 1, count);
          this.normalize(state);
        } else {
          state.lastRow = void 0;
          state.lastColumn = void 0;
        }
      });
    }
    sheet(name) {
      const cached = this.cache.get(name);
      if (cached) return cached;
      const sheet = this.spreadsheet.getSheetByName(name);
      if (!sheet) throw new AppError("A planilha ainda não está configurada. Execute configurarCompasso_ no editor do Apps Script.", 503);
      const state = { sheet };
      this.cache.set(name, state);
      return state;
    }
    mutate(name, operation) {
      try {
        operation(this.sheet(name));
      } catch (error) {
        this.cache.delete(name);
        throw error;
      }
    }
    capacity(state, rows, columns) {
      var _a, _b;
      const maxRows = (_a = state.maxRows) != null ? _a : state.maxRows = state.sheet.getMaxRows();
      const maxColumns = (_b = state.maxColumns) != null ? _b : state.maxColumns = state.sheet.getMaxColumns();
      if (rows > maxRows) {
        state.sheet.insertRowsAfter(maxRows, rows - maxRows);
        state.maxRows = rows;
      }
      if (columns > maxColumns) {
        state.sheet.insertColumnsAfter(maxColumns, columns - maxColumns);
        state.maxColumns = columns;
      }
    }
    normalize(state) {
      const values = state.values;
      while (values.length && values[values.length - 1].every((cell) => cell === "" || cell === void 0)) values.pop();
      let columns = 0;
      for (const row of values) {
        let last = row.length;
        while (last && (row[last - 1] === "" || row[last - 1] === void 0)) last--;
        columns = Math.max(columns, last);
      }
      state.values = values.map((row) => Array.from({ length: columns }, (_, index) => {
        var _a;
        return (_a = row[index]) != null ? _a : "";
      }));
      state.lastRow = values.length;
      state.lastColumn = columns;
    }
  };

  // backend/repositories/sheets-finance-repository.ts
  var prefix = ["sessionId", "snapshotId", "revision"];
  var SHEET_HEADERS = {
    Contas: [...prefix, "id", "name", "type", "openingBalanceCents", "createdAt"],
    Categorias: [...prefix, "id", "name", "kind", "color"],
    Lancamentos: [...prefix, "id", "description", "kind", "amountCents", "categoryId", "accountId", "occurredOn", "dueOn", "status", "paidOn", "version", "createdAt", "updatedAt", "isExample", "planId", "planMonth", "isCardPayment"],
    Planejamentos: [...prefix, "id", "type", "description", "amountCents", "startMonth", "dueDay", "categoryId", "accountId", "cardName", "installmentNumber", "totalInstallments", "endMonth", "createdAt", "updatedAt", "version", "archived", "archivedFromMonth"],
    RegistrosMensais: [...prefix, "id", "planId", "month", "status", "linkedEntryId", "updatedAt", "snapshotType", "snapshotDescription", "snapshotAmountCents", "snapshotDueOn", "snapshotCardName", "snapshotInstallmentNumber", "snapshotTotalInstallments", "snapshotRemainingAfterThisMonth", "snapshotFutureBalanceCents", "snapshotLastDueOn"],
    Preferencias: [...prefix, "id", "displayName", "exampleMode"],
    Sessoes: ["id", "tokenHash", "ponteiroCommit", "createdAt", "expiresAt", "status"],
    Comandos: ["sessionId", "snapshotId", "revision", "parentSnapshotId", "commandId", "resultJson", "createdAt", "fingerprint"]
  };
  var SHEETS_MAX_DATA_ROWS = 5e4;
  var SHEETS_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
  function storageError() {
    return new AppError("Os dados da planilha estão inconsistentes. Verifique os cabeçalhos e os registros da demonstração.", 500);
  }
  function string(value, allowEmpty = false) {
    if (typeof value !== "string" || !allowEmpty && !value) throw storageError();
    return value;
  }
  function number(value) {
    const parsed = typeof value === "number" ? value : typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(parsed)) throw storageError();
    return parsed;
  }
  function boolean(value) {
    if (typeof value === "boolean") return value;
    if (value === "true" || value === "TRUE") return true;
    if (value === "false" || value === "FALSE") return false;
    throw storageError();
  }
  function optionalString(value) {
    return value === "" || value === void 0 ? void 0 : string(value);
  }
  function optionalNumber(value) {
    return value === "" || value === void 0 ? void 0 : number(value);
  }
  function optionalBoolean(value) {
    return value === "" || value === void 0 ? void 0 : boolean(value);
  }
  function optionalField(name, value) {
    return value === void 0 ? {} : { [name]: value };
  }
  function pointer(raw) {
    let parsed;
    try {
      parsed = JSON.parse(string(raw));
    } catch (e) {
      throw storageError();
    }
    if (!parsed || typeof parsed !== "object") throw storageError();
    const result = parsed;
    if (!Number.isSafeInteger(result.revision) || result.revision < 0 || typeof result.snapshotId !== "string" || !result.snapshotId) throw storageError();
    return { revision: result.revision, snapshotId: result.snapshotId };
  }
  function assertUnique(items) {
    if (new Set(items.map((item) => item.id)).size !== items.length) throw storageError();
  }
  function decodeAccount(cells) {
    return { id: string(cells[3]), name: string(cells[4]), type: string(cells[5]), openingBalanceCents: number(cells[6]), createdAt: string(cells[7]) };
  }
  function decodeCategory(cells) {
    return { id: string(cells[3]), name: string(cells[4]), kind: string(cells[5]), color: string(cells[6]) };
  }
  function decodeEntry(cells) {
    return {
      id: string(cells[3]),
      description: string(cells[4]),
      kind: string(cells[5]),
      amountCents: number(cells[6]),
      categoryId: string(cells[7]),
      accountId: string(cells[8]),
      occurredOn: string(cells[9]),
      dueOn: string(cells[10]),
      status: string(cells[11]),
      version: number(cells[13]),
      createdAt: string(cells[14]),
      updatedAt: string(cells[15]),
      ...optionalField("paidOn", optionalString(cells[12])),
      ...optionalField("isExample", optionalBoolean(cells[16])),
      ...optionalField("planId", optionalString(cells[17])),
      ...optionalField("planMonth", optionalString(cells[18])),
      ...optionalField("isCardPayment", optionalBoolean(cells[19]))
    };
  }
  function decodePlan(cells) {
    return {
      id: string(cells[3]),
      type: string(cells[4]),
      description: string(cells[5]),
      amountCents: number(cells[6]),
      startMonth: string(cells[7]),
      dueDay: number(cells[8]),
      createdAt: string(cells[15]),
      updatedAt: string(cells[16]),
      version: number(cells[17]),
      ...optionalField("categoryId", optionalString(cells[9])),
      ...optionalField("accountId", optionalString(cells[10])),
      ...optionalField("cardName", optionalString(cells[11])),
      ...optionalField("installmentNumber", optionalNumber(cells[12])),
      ...optionalField("totalInstallments", optionalNumber(cells[13])),
      ...optionalField("endMonth", optionalString(cells[14])),
      ...optionalField("archived", optionalBoolean(cells[18])),
      ...optionalField("archivedFromMonth", optionalString(cells[19]))
    };
  }
  function decodeOccurrence(cells) {
    let snapshot;
    if (optionalString(cells[9])) {
      snapshot = {
        type: string(cells[9]),
        description: string(cells[10]),
        amountCents: number(cells[11]),
        dueOn: string(cells[12]),
        ...optionalField("cardName", optionalString(cells[13])),
        ...optionalField("installmentNumber", optionalNumber(cells[14])),
        ...optionalField("totalInstallments", optionalNumber(cells[15])),
        ...optionalField("remainingAfterThisMonth", optionalNumber(cells[16])),
        ...optionalField("futureBalanceCents", optionalNumber(cells[17])),
        ...optionalField("lastDueOn", optionalString(cells[18]))
      };
    }
    return {
      id: string(cells[3]),
      planId: string(cells[4]),
      month: string(cells[5]),
      status: string(cells[6]),
      updatedAt: string(cells[8]),
      ...optionalField("linkedEntryId", optionalString(cells[7])),
      ...snapshot ? { snapshot } : {}
    };
  }
  var SheetsFinanceRepository = class {
    constructor(port, clock = () => /* @__PURE__ */ new Date(), uuid = () => generateId_()) {
      this.port = port;
      this.clock = clock;
      this.uuid = uuid;
      for (const [name, headers] of Object.entries(SHEET_HEADERS)) this.port.ensureSheet(name, headers);
    }
    rows(name, fresh = false) {
      const values = this.port.read(name, { fresh });
      const headers = SHEET_HEADERS[name];
      if (!values.length || headers.some((header, index) => values[0][index] !== header)) throw storageError();
      return values.slice(1).map((cells, index) => ({ cells, row: index + 2 })).filter(({ cells }) => cells.some((cell) => cell !== ""));
    }
    now() {
      const now = this.clock();
      if (!Number.isFinite(now.getTime())) throw new AppError("O relógio da demonstração está indisponível.", 500);
      return now;
    }
    sessionRecords(fresh = false) {
      return this.rows("Sessoes", fresh).map(({ row, cells }) => {
        const commit = pointer(cells[2]);
        return {
          id: string(cells[0]),
          tokenHash: string(cells[1]),
          pointer: commit,
          revision: commit.revision,
          createdAt: string(cells[3]),
          expiresAt: string(cells[4]),
          status: string(cells[5]),
          row
        };
      });
    }
    isActive(session) {
      const expiry = Date.parse(session.expiresAt);
      if (!Number.isFinite(expiry)) throw storageError();
      return session.status === "active" && expiry > this.now().getTime();
    }
    activeSession(id, fresh = false) {
      const matches = this.sessionRecords(fresh).filter((session2) => session2.id === id);
      if (matches.length > 1) throw storageError();
      const session = matches[0];
      if (!session || !this.isActive(session)) throw new AppError("Sua sessão de demonstração expirou. Inicie outra demonstração.", 401);
      return session;
    }
    publicSession(session) {
      return { id: session.id, revision: session.revision, createdAt: session.createdAt, expiresAt: session.expiresAt };
    }
    commandChain(session) {
      var _a;
      const commands = this.rows("Comandos").filter(({ cells }) => cells[0] === session.id);
      const bySnapshot = /* @__PURE__ */ new Map();
      for (const row of commands) {
        const key = row.cells[1];
        const bucket = bySnapshot.get(key);
        if (bucket) bucket.push(row);
        else bySnapshot.set(key, [row]);
      }
      const chain = [];
      const visited = /* @__PURE__ */ new Set();
      let selected = session.pointer;
      while (true) {
        if (visited.has(selected.snapshotId)) throw storageError();
        visited.add(selected.snapshotId);
        const matches = ((_a = bySnapshot.get(selected.snapshotId)) != null ? _a : []).filter(({ cells: cells2 }) => number(cells2[2]) === selected.revision);
        if (matches.length !== 1) throw storageError();
        const cells = matches[0].cells;
        const command2 = {
          snapshotId: string(cells[1]),
          revision: number(cells[2]),
          parentSnapshotId: string(cells[3], true),
          commandId: string(cells[4]),
          resultJson: string(cells[5]),
          ...optionalField("fingerprint", optionalString(cells[7]))
        };
        chain.push(command2);
        if (selected.revision === 0) {
          if (command2.parentSnapshotId || command2.commandId !== "__init__") throw storageError();
          break;
        }
        if (!command2.parentSnapshotId) throw storageError();
        selected = { snapshotId: command2.parentSnapshotId, revision: selected.revision - 1 };
      }
      return chain;
    }
    quota(state, creating) {
      const existingRows = Object.keys(SHEET_HEADERS).reduce((sum, name) => sum + Math.max(0, this.port.read(name).length - 1), 0);
      const newRows = state.accounts.length + state.categories.length + state.entries.length + state.plans.length + state.occurrences.length + 2 + (creating ? 1 : 0);
      if (existingRows + newRows > SHEETS_MAX_DATA_ROWS) throw new AppError("O limite de armazenamento desta demonstração foi atingido. Aguarde a limpeza das sessões expiradas.", 429);
    }
    appendSnapshot(sessionId, snapshotId, revision, state) {
      for (const items of [state.accounts, state.categories, state.entries, state.plans, state.occurrences]) assertUnique(items);
      const head = [sessionId, snapshotId, revision];
      const append = (name, rows) => {
        if (rows.length) this.port.append(name, rows);
      };
      append("Contas", state.accounts.map((item) => [...head, item.id, item.name, item.type, item.openingBalanceCents, item.createdAt]));
      append("Categorias", state.categories.map((item) => [...head, item.id, item.name, item.kind, item.color]));
      append("Lancamentos", state.entries.map((item) => {
        var _a, _b, _c, _d, _e;
        return [...head, item.id, item.description, item.kind, item.amountCents, item.categoryId, item.accountId, item.occurredOn, item.dueOn, item.status, (_a = item.paidOn) != null ? _a : "", item.version, item.createdAt, item.updatedAt, (_b = item.isExample) != null ? _b : "", (_c = item.planId) != null ? _c : "", (_d = item.planMonth) != null ? _d : "", (_e = item.isCardPayment) != null ? _e : ""];
      }));
      append("Planejamentos", state.plans.map((item) => {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        return [...head, item.id, item.type, item.description, item.amountCents, item.startMonth, item.dueDay, (_a = item.categoryId) != null ? _a : "", (_b = item.accountId) != null ? _b : "", (_c = item.cardName) != null ? _c : "", (_d = item.installmentNumber) != null ? _d : "", (_e = item.totalInstallments) != null ? _e : "", (_f = item.endMonth) != null ? _f : "", item.createdAt, item.updatedAt, item.version, (_g = item.archived) != null ? _g : "", (_h = item.archivedFromMonth) != null ? _h : ""];
      }));
      append("RegistrosMensais", state.occurrences.map((item) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u;
        return [...head, item.id, item.planId, item.month, item.status, (_a = item.linkedEntryId) != null ? _a : "", item.updatedAt, (_c = (_b = item.snapshot) == null ? void 0 : _b.type) != null ? _c : "", (_e = (_d = item.snapshot) == null ? void 0 : _d.description) != null ? _e : "", (_g = (_f = item.snapshot) == null ? void 0 : _f.amountCents) != null ? _g : "", (_i = (_h = item.snapshot) == null ? void 0 : _h.dueOn) != null ? _i : "", (_k = (_j = item.snapshot) == null ? void 0 : _j.cardName) != null ? _k : "", (_m = (_l = item.snapshot) == null ? void 0 : _l.installmentNumber) != null ? _m : "", (_o = (_n = item.snapshot) == null ? void 0 : _n.totalInstallments) != null ? _o : "", (_q = (_p = item.snapshot) == null ? void 0 : _p.remainingAfterThisMonth) != null ? _q : "", (_s = (_r = item.snapshot) == null ? void 0 : _r.futureBalanceCents) != null ? _s : "", (_u = (_t = item.snapshot) == null ? void 0 : _t.lastDueOn) != null ? _u : ""];
      }));
      append("Preferencias", [[...head, state.settings.id, state.settings.displayName, state.settings.exampleMode]]);
    }
    createSession(tokenHash, state) {
      if (typeof tokenHash !== "string" || !tokenHash || tokenHash.length > 256) throw new AppError("O identificador da sessão é inválido.", 400);
      const previous = this.findSession(tokenHash);
      if (previous) return previous;
      this.quota(state, true);
      const now = this.now();
      const session = { id: this.uuid(), revision: 0, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + SHEETS_SESSION_TTL_MS).toISOString() };
      const commit = { revision: 0, snapshotId: this.uuid() };
      this.appendSnapshot(session.id, commit.snapshotId, 0, state);
      this.port.append("Comandos", [[session.id, commit.snapshotId, 0, "", "__init__", "null", session.createdAt, ""]]);
      this.port.flush();
      this.port.append("Sessoes", [[session.id, tokenHash, JSON.stringify(commit), session.createdAt, session.expiresAt, "active"]]);
      this.port.flush();
      return session;
    }
    findSession(tokenHash) {
      const sessions = this.sessionRecords().filter((session) => session.tokenHash === tokenHash && this.isActive(session));
      if (sessions.length > 1) throw storageError();
      return sessions[0] ? this.publicSession(sessions[0]) : void 0;
    }
    load(sessionId) {
      const session = this.activeSession(sessionId);
      this.commandChain(session);
      const current = (name) => this.rows(name).filter(({ cells }) => cells[0] === sessionId && cells[1] === session.pointer.snapshotId && number(cells[2]) === session.revision).map(({ cells }) => cells);
      const settings = current("Preferencias");
      if (settings.length !== 1) throw storageError();
      const state = {
        accounts: current("Contas").map(decodeAccount),
        categories: current("Categorias").map(decodeCategory),
        entries: current("Lancamentos").map(decodeEntry),
        plans: current("Planejamentos").map(decodePlan),
        occurrences: current("RegistrosMensais").map(decodeOccurrence),
        settings: { id: string(settings[0][3]), displayName: string(settings[0][4], true), exampleMode: boolean(settings[0][5]) }
      };
      for (const items of [state.accounts, state.categories, state.entries, state.plans, state.occurrences]) assertUnique(items);
      return { state, revision: session.revision };
    }
    findCommand(sessionId, commandId) {
      const session = this.activeSession(sessionId);
      if (commandId === "__init__") return void 0;
      const command2 = this.commandChain(session).find((item) => item.commandId === commandId);
      if (!command2) return void 0;
      let result;
      try {
        result = JSON.parse(command2.resultJson);
      } catch (e) {
        throw storageError();
      }
      return { result, ...command2.fingerprint ? { fingerprint: command2.fingerprint } : {} };
    }
    commit(sessionId, expectedRevision, commandId, _before, after, result, fingerprint) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision === Number.MAX_SAFE_INTEGER || typeof commandId !== "string" || !commandId || commandId.length > 160 || commandId === "__init__" || fingerprint !== void 0 && (typeof fingerprint !== "string" || fingerprint.length > 256)) throw new AppError("A revisão ou o identificador do comando é inválido.", 400);
      const session = this.activeSession(sessionId);
      if (session.revision !== expectedRevision || this.findCommand(sessionId, commandId)) return { applied: false, revision: session.revision };
      let resultJson;
      try {
        resultJson = JSON.stringify(result === void 0 ? null : result);
      } catch (e) {
        throw new AppError("O resultado do comando não pode ser armazenado.", 400);
      }
      if (resultJson === void 0 || resultJson.length > 5e4) throw new AppError("O resultado do comando excede o limite de armazenamento.", 400);
      this.quota(after, false);
      const next = { revision: expectedRevision + 1, snapshotId: this.uuid() };
      this.appendSnapshot(sessionId, next.snapshotId, next.revision, after);
      this.port.append("Comandos", [[sessionId, next.snapshotId, next.revision, session.pointer.snapshotId, commandId, resultJson, this.now().toISOString(), fingerprint != null ? fingerprint : ""]]);
      this.port.flush();
      const latest = this.activeSession(sessionId, true);
      if (latest.revision !== expectedRevision || latest.pointer.snapshotId !== session.pointer.snapshotId) return { applied: false, revision: latest.revision };
      this.port.replaceCell("Sessoes", latest.row, 3, JSON.stringify(next));
      this.port.flush();
      return { applied: true, revision: next.revision };
    }
    invalidateSession(sessionId) {
      const matches = this.sessionRecords().filter((session) => session.id === sessionId);
      if (matches.length > 1) throw storageError();
      if (matches[0] && matches[0].status !== "expired") {
        this.port.replaceCell("Sessoes", matches[0].row, 6, "expired");
        this.port.flush();
      }
    }
    cleanupExpired() {
      const sessions = this.sessionRecords();
      const registered = new Set(sessions.map((session) => session.id));
      const expired = new Set(sessions.filter((session) => !this.isActive(session)).map((session) => session.id));
      const tables = ["Contas", "Categorias", "Lancamentos", "Planejamentos", "RegistrosMensais", "Preferencias", "Comandos", "Sessoes"];
      const stored = new Map(tables.map((name) => [name, this.rows(name)]));
      for (const name of tables) {
        if (name === "Sessoes") continue;
        for (const { cells } of stored.get(name)) {
          const id = string(cells[0]);
          if (!registered.has(id)) expired.add(id);
        }
      }
      if (!expired.size) return;
      for (const name of tables) {
        const rows = stored.get(name).filter(({ cells }) => expired.has(string(cells[0]))).map(({ row }) => row).sort((a, b) => b - a);
        for (let index = 0; index < rows.length; ) {
          let lowest = rows[index];
          let count = 1;
          while (index + count < rows.length && rows[index + count] === lowest - 1) {
            lowest -= 1;
            count += 1;
          }
          this.port.deleteRows(name, lowest, count);
          index += count;
        }
      }
      this.port.flush();
    }
  };

  // backend/apps-script.ts
  var SPREADSHEET_PROPERTY = "COMPASSO_SPREADSHEET_ID";
  var MAX_ACTIVE_SESSIONS = 50;
  function serializeError(error) {
    return JSON.stringify(error instanceof AppError ? { error: error.message, status: error.status } : { error: "Não foi possível concluir a operação no Google Sheets. Tente novamente.", status: 503 });
  }
  function canonical(value, depth = 0) {
    var _a;
    if (depth > 30) throw new AppError("O comando possui uma estrutura muito profunda.", 400);
    if (Array.isArray(value)) return `[${value.map((item) => canonical(item, depth + 1)).join(",")}]`;
    if (value && typeof value === "object") {
      const object3 = value;
      return `{${Object.keys(object3).sort().map((key) => `${JSON.stringify(key)}:${canonical(object3[key], depth + 1)}`).join(",")}}`;
    }
    return (_a = JSON.stringify(value)) != null ? _a : "null";
  }
  function parseCommand(raw) {
    if (typeof raw !== "string" || raw.length > 25e5) throw new AppError("O comando enviado é inválido ou muito grande.", 400);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new AppError("Não foi possível ler o comando enviado.", 400);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AppError("O comando enviado é inválido.", 400);
    const command2 = parsed;
    if (typeof command2.id !== "string" || !/^[a-zA-Z0-9_-]{12,100}$/.test(command2.id) || typeof command2.type !== "string" || command2.type.length > 40 || !command2.payload || typeof command2.payload !== "object" || Array.isArray(command2.payload)) throw new AppError("O comando enviado é inválido.", 400);
    return { id: command2.id, type: command2.type, payload: command2.payload };
  }
  function createAppsScriptController(runtime2, clock = () => /* @__PURE__ */ new Date()) {
    const hash = (value) => runtime2.Utilities.computeDigest(runtime2.Utilities.DigestAlgorithm.SHA_256, value, runtime2.Utilities.Charset.UTF_8).map((byte) => ((byte + 256) % 256).toString(16).padStart(2, "0")).join("");
    const locked = (work) => {
      let lock;
      let acquired = false;
      let output;
      try {
        lock = runtime2.LockService.getScriptLock();
        lock.waitLock(15e3);
        acquired = true;
        output = JSON.stringify(work());
      } catch (error) {
        output = serializeError(error);
      } finally {
        if (acquired) {
          try {
            lock == null ? void 0 : lock.releaseLock();
          } catch (error) {
            output = serializeError(error);
          }
        }
      }
      return output;
    };
    const repository = () => {
      const spreadsheetId = runtime2.PropertiesService.getScriptProperties().getProperty(SPREADSHEET_PROPERTY);
      if (!spreadsheetId) throw new AppError("A demonstração ainda não está configurada. Execute configurarCompasso_ no editor do Apps Script.", 503);
      const spreadsheet = runtime2.SpreadsheetApp.openById(spreadsheetId);
      const port = new AppsScriptSheetPort(spreadsheet, () => runtime2.SpreadsheetApp.flush());
      return { repository: new SheetsFinanceRepository(port, clock, () => runtime2.Utilities.getUuid()), port };
    };
    const validatedToken = (token) => {
      if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new AppError("A sessão de demonstração é inválida ou expirou. Inicie uma nova demonstração.", 401);
      return token;
    };
    const authenticate = (repo, token) => {
      const session = repo.findSession(hash(validatedToken(token)));
      if (!session || Date.parse(session.expiresAt) <= clock().getTime()) throw new AppError("A sessão de demonstração é inválida ou expirou. Inicie uma nova demonstração.", 401);
      return session;
    };
    const response = (state, revision, expiresAt, extra = {}) => ({
      state,
      revision,
      database: "Google Sheets",
      mode: "demo",
      sessionExpiresAt: expiresAt,
      ...extra
    });
    return {
      configurar: () => locked(() => {
        const properties = runtime2.PropertiesService.getScriptProperties();
        const existing = properties.getProperty(SPREADSHEET_PROPERTY);
        const spreadsheet = existing ? runtime2.SpreadsheetApp.openById(existing) : runtime2.SpreadsheetApp.create("Compasso — Demonstração");
        if (!existing) {
          properties.setProperty(SPREADSHEET_PROPERTY, spreadsheet.getId());
          const first = spreadsheet.getSheets()[0];
          if (first && !first.getLastRow()) first.setName("Contas");
        }
        const port = new AppsScriptSheetPort(spreadsheet, () => runtime2.SpreadsheetApp.flush());
        for (const [name, headers] of Object.entries(SHEET_HEADERS)) port.ensureSheet(name, headers);
        port.flush();
        return { configured: true, spreadsheetUrl: spreadsheet.getUrl(), database: "Google Sheets" };
      }),
      bootstrap: (token) => locked(() => {
        validatedToken(token);
        const { repository: repo } = repository();
        const session = authenticate(repo, token);
        const loaded = repo.load(session.id);
        return response(loaded.state, loaded.revision, session.expiresAt);
      }),
      createDemoSession: (previousToken) => locked(() => {
        if (previousToken !== void 0 && previousToken !== null) validatedToken(previousToken);
        const { repository: repo, port } = repository();
        const previous = previousToken === void 0 || previousToken === null ? void 0 : authenticate(repo, previousToken);
        repo.cleanupExpired();
        const active = port.read("Sessoes").slice(1).filter((row) => row[5] === "active" && Date.parse(String(row[4])) > clock().getTime()).length;
        if (active - (previous ? 1 : 0) >= MAX_ACTIVE_SESSIONS) throw new AppError("A demonstração atingiu o limite de sessões ativas. Tente novamente mais tarde.", 429);
        const token = `${runtime2.Utilities.getUuid()}${runtime2.Utilities.getUuid()}`.replace(/-/g, "").toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(token)) throw new AppError("Não foi possível gerar uma sessão segura.", 503);
        const state = createDemoState(clock());
        const session = repo.createSession(hash(token), state);
        if (previous) repo.invalidateSession(previous.id);
        return response(state, session.revision, session.expiresAt, { sessionToken: token });
      }),
      command: (token, commandJson) => locked(() => {
        var _a, _b;
        validatedToken(token);
        const { repository: repo } = repository();
        const session = authenticate(repo, token);
        const command2 = parseCommand(commandJson);
        const fingerprint = hash(canonical({ type: command2.type, payload: command2.payload }));
        const replay = repo.findCommand(session.id, command2.id);
        const loaded = repo.load(session.id);
        if (replay) {
          if (replay.fingerprint !== fingerprint) throw new AppError("Este identificador de comando já foi usado com outros dados.", 409);
          return response(loaded.state, loaded.revision, session.expiresAt, { result: (_a = replay.result) != null ? _a : null });
        }
        const applied = new FinanceService(clock).apply(loaded.state, command2);
        const result = (_b = applied.result) != null ? _b : null;
        const committed = repo.commit(session.id, loaded.revision, command2.id, loaded.state, applied.state, result, fingerprint);
        if (!committed.applied) throw new AppError("Os dados foram alterados. Atualize a demonstração e tente novamente.", 409);
        return response(applied.state, committed.revision, session.expiresAt, { result });
      })
    };
  }
  function runtime() {
    if (typeof SpreadsheetApp === "undefined" || typeof PropertiesService === "undefined" || typeof LockService === "undefined" || typeof Utilities === "undefined") throw new AppError("Este servidor deve ser executado no Google Apps Script.", 503);
    return { SpreadsheetApp, PropertiesService, LockService, Utilities };
  }
  function defaultCall(work) {
    try {
      return work(createAppsScriptController(runtime()));
    } catch (error) {
      return serializeError(error);
    }
  }
  function configurar() {
    return defaultCall((controller) => controller.configurar());
  }
  function bootstrap(token) {
    return defaultCall((controller) => controller.bootstrap(token));
  }
  function createDemoSession(previousToken) {
    return defaultCall((controller) => controller.createDemoSession(previousToken));
  }
  function command(token, commandJson) {
    return defaultCall((controller) => controller.command(token, commandJson));
  }
  return __toCommonJS(apps_script_exports);
})();

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
