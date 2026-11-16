import { DatabaseSync } from 'node:sqlite';
import type { D1Like, D1PreparedStatement, D1Result, SqlValue } from './d1-types';

class NodeSqliteStatement implements D1PreparedStatement {
  constructor(readonly database: DatabaseSync, readonly query: string, readonly values: SqlValue[] = []) {}

  bind(...values: SqlValue[]): D1PreparedStatement {
    return new NodeSqliteStatement(this.database, this.query, values);
  }

  execute<T = Record<string, unknown>>(): D1Result<T> {
    const statement = this.database.prepare(this.query);
    if (statement.columns().length) {
      return { results: statement.all(...this.values) as T[], success: true, meta: { changes: 0 } };
    }
    const result = statement.run(...this.values);
    return { results: [], success: true, meta: { changes: Number(result.changes) } };
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.database.prepare(this.query).get(...this.values);
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> { return this.execute<T>(); }
  async run(): Promise<D1Result> { return this.execute(); }
}

/** Adaptador de desenvolvimento/testes. Produção recebe diretamente env.DB do D1. */
export class NodeSqliteDatabase implements D1Like {
  readonly database: DatabaseSync;

  constructor(path = ':memory:') {
    this.database = new DatabaseSync(path);
    this.database.exec('PRAGMA foreign_keys = ON;');
  }

  exec(sql: string): void { this.database.exec(sql); }
  close(): void { this.database.close(); }
  prepare(query: string): D1PreparedStatement { return new NodeSqliteStatement(this.database, query); }

  async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const results = statements.map((statement) => {
        if (!(statement instanceof NodeSqliteStatement) || statement.database !== this.database) throw new Error('O comando SQL pertence a outro adaptador.');
        return statement.execute<T>();
      });
      this.database.exec('COMMIT;');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
  }
}
