import type { CaseResult } from '../analyze/diff';
import type { PlanCase } from '../plan/planFile';

export type CaseCategory = 'blocking' | 'difference' | 'equal' | 'needs-signoff';

export const categorizeCase = (
  plan: Pick<PlanCase, 'evidence' | 'flags'>,
  result: Pick<CaseResult, 'gaps' | 'status'>,
): CaseCategory => {
  if (result.status === 'error' || result.status === 'unstable') return 'blocking';
  if (plan.flags.some((flag) => flag.startsWith('STYLEX_UNSUPPORTED:'))) return 'blocking';
  if (result.status === 'difference') return 'difference';
  const unchanged = ['STYLE_CHAIN_UNCHANGED', 'FILE_RULES_UNCHANGED'].every((item) =>
    plan.evidence?.includes(item),
  );
  const gaps = unchanged ? [] : result.gaps;
  return plan.flags.length || gaps.length ? 'needs-signoff' : 'equal';
};
