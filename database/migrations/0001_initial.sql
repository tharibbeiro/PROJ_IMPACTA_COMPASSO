-- Compasso Acadêmico: tabelas estruturadas e isolamento por sessão de demonstração.
-- Aplicar uma vez pela ferramenta de migrações. A aplicação não executa DDL em requisições.
CREATE TABLE demo_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_command_id TEXT
);
CREATE INDEX demo_sessions_expiry ON demo_sessions(expires_at);

CREATE TABLE accounts (
  session_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  type TEXT NOT NULL CHECK (type IN ('bank', 'cash')),
  opening_balance_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, id),
  FOREIGN KEY (session_id) REFERENCES demo_sessions(id) ON DELETE CASCADE
);

CREATE TABLE categories (
  session_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
  color TEXT NOT NULL,
  PRIMARY KEY (session_id, id),
  FOREIGN KEY (session_id) REFERENCES demo_sessions(id) ON DELETE CASCADE
);

CREATE TABLE plans (
  session_id TEXT NOT NULL,
  id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('salary', 'fixed', 'cardFixed', 'installment', 'annual', 'reserve')),
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  start_month TEXT NOT NULL,
  due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  category_id TEXT,
  account_id TEXT,
  card_name TEXT,
  installment_number INTEGER,
  total_installments INTEGER,
  end_month TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  archived INTEGER CHECK (archived IN (0,1)),
  archived_from_month TEXT,
  PRIMARY KEY (session_id, id),
  FOREIGN KEY (session_id) REFERENCES demo_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id, category_id) REFERENCES categories(session_id, id),
  FOREIGN KEY (session_id, account_id) REFERENCES accounts(session_id, id)
);
CREATE INDEX plans_by_session_month ON plans(session_id, start_month);

CREATE TABLE entries (
  session_id TEXT NOT NULL,
  id TEXT NOT NULL,
  description TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  category_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  occurred_on TEXT NOT NULL,
  due_on TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid')),
  paid_on TEXT,
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_example INTEGER CHECK (is_example IN (0,1)),
  plan_id TEXT,
  plan_month TEXT,
  is_card_payment INTEGER CHECK (is_card_payment IN (0,1)),
  PRIMARY KEY (session_id, id),
  UNIQUE (session_id, plan_id, plan_month),
  CHECK ((plan_id IS NULL) = (plan_month IS NULL)),
  CHECK (status <> 'paid' OR paid_on IS NOT NULL),
  CHECK (is_card_payment IS NULL OR is_card_payment = 0 OR (kind = 'expense' AND plan_id IS NULL)),
  FOREIGN KEY (session_id) REFERENCES demo_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id, category_id) REFERENCES categories(session_id, id),
  FOREIGN KEY (session_id, account_id) REFERENCES accounts(session_id, id),
  FOREIGN KEY (session_id, plan_id) REFERENCES plans(session_id, id)
);
CREATE INDEX entries_by_session_month ON entries(session_id, occurred_on);
CREATE INDEX entries_by_session_account ON entries(session_id, account_id);

CREATE TABLE plan_occurrences (
  session_id TEXT NOT NULL,
  id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  month TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'done')),
  linked_entry_id TEXT,
  updated_at TEXT NOT NULL,
  snapshot_type TEXT,
  snapshot_description TEXT,
  snapshot_amount_cents INTEGER CHECK (snapshot_amount_cents > 0),
  snapshot_due_on TEXT,
  snapshot_card_name TEXT,
  snapshot_installment_number INTEGER,
  snapshot_total_installments INTEGER,
  snapshot_remaining_after_month INTEGER,
  snapshot_future_balance_cents INTEGER,
  snapshot_last_due_on TEXT,
  PRIMARY KEY (session_id, id),
  UNIQUE (session_id, plan_id, month),
  UNIQUE (session_id, linked_entry_id),
  FOREIGN KEY (session_id) REFERENCES demo_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id, plan_id) REFERENCES plans(session_id, id),
  FOREIGN KEY (session_id, linked_entry_id) REFERENCES entries(session_id, id)
);
CREATE INDEX occurrences_by_session_month ON plan_occurrences(session_id, month);

CREATE TABLE preferences (
  session_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  example_mode INTEGER NOT NULL CHECK (example_mode IN (0,1)),
  FOREIGN KEY (session_id) REFERENCES demo_sessions(id) ON DELETE CASCADE
);

CREATE TABLE processed_commands (
  session_id TEXT NOT NULL,
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, id),
  FOREIGN KEY (session_id) REFERENCES demo_sessions(id) ON DELETE CASCADE
);
