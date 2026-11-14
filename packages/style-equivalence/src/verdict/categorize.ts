import type { CaseResult } from '../analyze/diff';
import { INLINE_MASK } from '../plan/inlineStyle';
import type { PlanCase } from '../plan/planFile';

export type CaseCategory = 'blocking' | 'difference' | 'equal' | 'needs-signoff';

type CategorizedPlan = Pick<PlanCase, 'evidence' | 'flags'> & Partial<Pick<PlanCase, 'combos'>>;
type CategorizedResult = Pick<CaseResult, 'gaps' | 'status'> &
  Partial<Pick<CaseResult, 'comboDifferences'>>;

export const differsOnlyUnmasked = (plan: CategorizedPlan, result: CategorizedResult) =>
  result.status === 'difference' &&
  Boolean(result.comboDifferences?.length) &&
  result.comboDifferences!.every((item) => plan.combos?.[item.combo]?.[INLINE_MASK] === false);

export const categorizeCase = (plan: CategorizedPlan, result: CategorizedResult): CaseCategory => {
  if (result.status === 'error' || result.status === 'unstable') return 'blocking';
  if (plan.flags.some((flag) => flag.startsWith('STYLEX_UNSUPPORTED:'))) return 'blocking';
  if (differsOnlyUnmasked(plan, result)) return 'needs-signoff';
  if (result.status === 'difference') return 'difference';
  const unchanged = ['STYLE_CHAIN_UNCHANGED', 'FILE_RULES_UNCHANGED'].every((item) =>
    plan.evidence?.includes(item),
  );
  const gaps = unchanged ? [] : result.gaps;
  return plan.flags.length || gaps.length ? 'needs-signoff' : 'equal';
};
