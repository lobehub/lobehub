import type { DeviceGitPullRequestMergeContext } from '@lobechat/types';

interface ActionLockInput {
  /** The sidebar's branch + linked-PR reads confirmed this PR number. */
  confirmed: boolean;
  /** The failed branch / linked-PR read that keeps `confirmed` false. */
  confirmError?: unknown;
  context: DeviceGitPullRequestMergeContext | null | undefined;
  contextConfirmed: boolean;
  contextError: unknown;
  detailConfirmed: boolean;
  detailError: unknown;
}

/**
 * What the PR pane may act on. Persisted rows keep painting; mutations wait:
 *
 * - `locked`: the PR itself (branch, linked PR, detail) is not confirmed yet —
 *   every action, comments included, is refused.
 * - `policyLocked`: the merge context (permissions, required checks, base
 *   drift) on screen is last session's — policy-driven actions (merge, update,
 *   bypass, close / reopen, change base) wait for the live read.
 *
 * A failed context read drops the cached policy rather than locking forever:
 * the pane falls back to the core detail, as it does with no context at all,
 * and the merge dock stops reporting it as loading.
 *
 * `refreshFailed`: a live read failed while the pane still paints a persisted
 * row it cannot act on — the pane must say so and offer a retry.
 */
export const resolvePullRequestActionLock = ({
  confirmError,
  confirmed,
  context,
  contextConfirmed,
  contextError,
  detailConfirmed,
  detailError,
}: ActionLockInput) => {
  const usableContext = contextConfirmed || !contextError ? context : undefined;
  const locked = !confirmed || !detailConfirmed;
  const policyLocked = usableContext !== undefined && !contextConfirmed;
  return {
    context: usableContext,
    contextLoading: locked || policyLocked || (usableContext === undefined && !contextError),
    locked,
    policyLocked,
    refreshFailed:
      (!confirmed && !!confirmError) ||
      (!detailConfirmed && !!detailError) ||
      (!contextConfirmed && !!contextError),
  };
};
