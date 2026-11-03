import type { CaseResult } from '../analyze/diff';
import type { PlanCase } from '../plan/planFile';

export type CaseCategory = 'blocking' | 'difference' | 'equal' | 'needs-signoff';

export const categorizeCase = (
  plan: PlanCase,
  result: Pick<CaseResult, 'status'>,
): CaseCategory => {
  if (result.status === 'error' || result.status === 'unstable') return 'blocking';
  if (result.status === 'difference') return 'difference';
  return plan.flags.length ? 'needs-signoff' : 'equal';
};
