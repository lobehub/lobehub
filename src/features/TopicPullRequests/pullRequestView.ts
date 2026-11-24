import type {
  DeviceGitPullRequestCheck,
  DeviceGitPullRequestCiStatus,
  DeviceGitPullRequestDetail,
  TopicPullRequestAutoFix,
  TopicPullRequestItem,
  TopicPullRequestLinkSource,
} from '@lobechat/types';

import type { PullRequestState } from '@/features/AgentSidebar/Topic/List/Item/metaCardData';

/**
 * One linked pull request as the UI shows it, resolved from the best source
 * at hand: the GitHub App (confirmed), this session's device answer
 * (confirmed), the device answer persisted from an earlier session (last
 * known), or the status the agent's own commands left on the Work row.
 */
export interface TopicPullRequestView {
  /** Present only when the GitHub App tracks the PR: Auto-fix needs its webhooks. */
  autoFix?: TopicPullRequestAutoFix;
  ciStatus?: DeviceGitPullRequestCiStatus;
  /** Confirmed by the GitHub App or by the device in this session. */
  confirmed: boolean;
  identifier: string;
  isDraft: boolean;
  /** A detail read from the execution device exists (it shares the working directory's repo). */
  localDetail: boolean;
  mergedAt?: string | null;
  number: number;
  repoFullName: string;
  /** How the topic came to it; see {@link TopicPullRequestLinkSource}. */
  source: TopicPullRequestLinkSource;
  state: PullRequestState;
  title: string;
  url: string;
  /** The app can vouch it belongs to the topic; merge / close stay locked otherwise. */
  vouched: boolean;
}

/** Device detail for a number, with whether this session confirmed it. */
export interface DevicePullRequestRead {
  confirmed: boolean;
  detail: DeviceGitPullRequestDetail;
}

const FAILING_CHECKS = new Set<DeviceGitPullRequestCheck['status']>(['failure']);

export const rollupChecks = (
  checks: DeviceGitPullRequestCheck[],
): DeviceGitPullRequestCiStatus | undefined => {
  if (checks.length === 0) return undefined;
  if (checks.some((check) => FAILING_CHECKS.has(check.status))) return 'failure';
  if (checks.some((check) => check.status === 'pending')) return 'pending';
  return 'success';
};

/**
 * `gh pr view <n>` runs in the working directory, so it reads that number in
 * the directory's own repository — which is only the linked PR when the
 * repositories agree.
 */
export const isSameRepository = (detail: DeviceGitPullRequestDetail, repoFullName: string) =>
  `${detail.repo.owner}/${detail.repo.name}`.toLowerCase() === repoFullName.toLowerCase();

const fallbackUrl = (item: TopicPullRequestItem) =>
  item.url ?? `https://github.com/${item.repoFullName}/pull/${item.number}`;

export const resolvePullRequestView = (
  item: TopicPullRequestItem,
  device?: DevicePullRequestRead,
): TopicPullRequestView => {
  const base = {
    identifier: item.identifier,
    number: item.number,
    repoFullName: item.repoFullName,
    // Persisted lists from before these fields existed read as the strongest kind.
    source: item.source ?? 'created',
    url: fallbackUrl(item),
    vouched: item.vouched ?? true,
  };

  const sameRepo = !!device && isSameRepository(device.detail, item.repoFullName);

  if (item.scm) {
    return {
      ...base,
      autoFix: item.scm.autoFix,
      ciStatus: item.scm.ciStatus ?? undefined,
      confirmed: true,
      isDraft: item.scm.isDraft,
      localDetail: sameRepo,
      mergedAt: item.scm.mergedAt ? new Date(item.scm.mergedAt).toISOString() : null,
      state: item.scm.state,
      title: item.scm.title ?? item.title ?? item.repoFullName,
    };
  }

  if (device && sameRepo) {
    const { detail } = device;
    return {
      ...base,
      ciStatus: rollupChecks(detail.checks ?? []),
      confirmed: device.confirmed,
      isDraft: detail.isDraft,
      localDetail: true,
      mergedAt: detail.mergedAt ?? null,
      state: detail.state,
      title: detail.title,
      url: detail.url || base.url,
    };
  }

  const status = item.status?.toLowerCase();
  return {
    ...base,
    confirmed: false,
    isDraft: status === 'draft',
    localDetail: false,
    state: status === 'merged' ? 'merged' : status === 'closed' ? 'closed' : 'open',
    // No title known yet (a PR linked by hand before any read): name its repo
    // rather than repeat the number the row already shows.
    title: item.title ?? item.repoFullName,
  };
};

/**
 * The PR the control bar names: the most recently linked one still open,
 * otherwise the most recently linked one. Views keep the server's order
 * (latest link first).
 */
export const pickPrimaryPullRequest = (views: TopicPullRequestView[]) =>
  views.find((view) => view.state === 'open') ?? views[0];
