import type { GitBranchSummary } from '@/services/git';

/**
 * What the staged bar may do with a branch read. A hydrated row from the last
 * session is only a label: the switcher would treat it as current and skip a
 * checkout to that branch, so switching waits for this session's probe.
 */
export const getStagedBranchState = (
  data: GitBranchSummary | undefined,
  isConfirmed: boolean,
): 'hidden' | 'detached' | 'confirming' | 'switchable' => {
  if (!data?.branch) return 'hidden';
  if (data.detached) return 'detached';
  return isConfirmed ? 'switchable' : 'confirming';
};
