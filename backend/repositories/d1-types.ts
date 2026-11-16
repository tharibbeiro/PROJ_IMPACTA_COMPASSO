/** Subconjunto de D1 utilizado pelo repositório, também implementado pelo adaptador local. */
export type SqlValue = string | number | null;

export interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success?: boolean;
  meta?: { changes?: number; [key: string]: unknown };
  error?: string;
}

export interface D1PreparedStatement {
  bind(...values: SqlValue[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Like {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}
