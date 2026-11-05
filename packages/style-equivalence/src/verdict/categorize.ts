import type { CaseResult } from '../analyze/diff';
import type { PlanCase } from '../plan/planFile';

export type CaseCategory = 'blocking' | 'difference' | 'equal' | 'needs-signoff';

export const categorizeCase = (
  plan: Pick<PlanCase, 'flags'>,
  result: Pick<CaseResult, 'gaps' | 'status'>,
): CaseCategory => {
  if (result.status === 'error' || result.status === 'unstable') return 'blocking';
  if (result.status === 'difference') return 'difference';
  return plan.flags.length || result.gaps.length ? 'needs-signoff' : 'equal';
};
