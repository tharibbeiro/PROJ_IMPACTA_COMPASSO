import { localDate } from '../domain/finance';
import type { Entry } from '../domain/types';
import type { PlanInput, PlanItem, PlanOccurrence, PlanningSnapshot } from '../domain/planning-types';
import { getCachedState, runRemoteCommand } from './repository';

/** Consulta a cópia em memória de uma resposta confirmada pelo Apps Script. */
export async function getPlanningSnapshot(): Promise<PlanningSnapshot> {
  const { plans, occurrences } = getCachedState();
  return { plans: plans.sort((a, b) => a.createdAt.localeCompare(b.createdAt)), occurrences };
}

export function savePlan(input: PlanInput, id?: string, expectedVersion?: number): Promise<PlanItem> {
  return runRemoteCommand('savePlan', { input, ...(id ? { id } : {}), ...(expectedVersion === undefined ? {} : { expectedVersion }) });
}

export function deletePlan(id: string, expectedVersion: number, fromMonth = localDate().slice(0, 7)): Promise<PlanItem> {
  return runRemoteCommand('deletePlan', { id, expectedVersion, fromMonth });
}

export function realizePlan(planId: string, month: string): Promise<Entry> {
  return runRemoteCommand('realizePlan', { planId, month });
}

export function settlePlan(planId: string, month: string, options: { paidOn?: string; accountId?: string } = {}): Promise<Entry> {
  return runRemoteCommand('settlePlan', { planId, month, options });
}

export function setPlanningChecked(planId: string, month: string, checked: boolean): Promise<PlanOccurrence> {
  return runRemoteCommand('setPlanningChecked', { planId, month, checked });
}

export function linkPlanEntry(planId: string, month: string, entryId: string, expectedVersion?: number): Promise<Entry> {
  return runRemoteCommand('linkPlanEntry', { planId, month, entryId, ...(expectedVersion === undefined ? {} : { expectedVersion }) });
}

export const setCardChecked = setPlanningChecked;
