import { localDate } from '../domain/finance';
import type { Entry } from '../domain/types';
import type { PlanInput, PlanItem, PlanOccurrence, PlanningSnapshot } from '../domain/planning-types';
import { db, runRemoteCommand } from './repository';

/** Consulta somente o cache de uma resposta já confirmada pela API. */
export async function getPlanningSnapshot(): Promise<PlanningSnapshot> {
  return db.transaction('r', db.plans, db.planOccurrences, async () => {
    const [plans, occurrences] = await Promise.all([db.plans.toArray(), db.planOccurrences.toArray()]);
    return { plans: plans.sort((a, b) => a.createdAt.localeCompare(b.createdAt)), occurrences };
  });
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
