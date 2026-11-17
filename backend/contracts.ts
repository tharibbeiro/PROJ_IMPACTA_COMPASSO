import type { FinanceSnapshot } from '../shared/domain/types';
import type { PlanningSnapshot } from '../shared/domain/planning-types';

/** Estado entregue à camada de negócio; não contém detalhes da planilha. */
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
  createSession(tokenHash: string, state: AcademicState): DemoSession;
  findSession(tokenHash: string): DemoSession | undefined;
  load(sessionId: string): LoadedFinanceState;
  findCommand(sessionId: string, commandId: string): { result: unknown; fingerprint?: string } | undefined;
  commit(sessionId: string, expectedRevision: number, commandId: string, before: AcademicState, after: AcademicState, result: unknown, fingerprint?: string): CommitResult;
  invalidateSession(sessionId: string): void;
  cleanupExpired(): void;
}
