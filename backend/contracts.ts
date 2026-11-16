import type { FinanceSnapshot } from '../shared/domain/types';
import type { PlanningSnapshot } from '../shared/domain/planning-types';

/** Estado entregue à camada de negócio; não contém detalhes do banco SQL. */
export interface AcademicState extends FinanceSnapshot, PlanningSnapshot {}

/** O controlador valida o envelope; o serviço valida o comando e suas regras. */
export interface FinanceCommand {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}

export class AppError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

export interface DemoSession {
  id: string;
  revision: number;
  createdAt: string;
  expiresAt: string;
}

export interface LoadedFinanceState {
  state: AcademicState;
  revision: number;
}

export interface CommitResult {
  applied: boolean;
  revision: number;
}

export interface FinanceRepository {
  createSession(tokenHash: string, state: AcademicState): Promise<DemoSession>;
  findSession(tokenHash: string): Promise<DemoSession | undefined>;
  load(sessionId: string): Promise<LoadedFinanceState>;
  findCommand(sessionId: string, commandId: string): Promise<{ result: unknown } | undefined>;
  commit(sessionId: string, expectedRevision: number, commandId: string, before: AcademicState, after: AcademicState, result: unknown): Promise<CommitResult>;
  cleanupExpired(): Promise<void>;
}
