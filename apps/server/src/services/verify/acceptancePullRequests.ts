import type {
  AcceptancePullRequestLink,
  ScmChangeRequestState,
  ScmCiStatus,
  ScmReviewDecision,
} from '@lobechat/types';

import type { ScmChangeRequestItem } from '@/database/schemas';

import type { ParsedChangeRequestUrl } from '../scm/changeRequestUrl';

/** GitHub names are case-insensitive, so the identity folds case. */
const identity = (link: { number: number; provider: string; repoFullName: string }) =>
  `${link.provider}:${link.repoFullName.toLowerCase()}#${link.number}`;

/** Add or refresh a hand link; the same PR spelled differently is one link. */
export const addPullRequestLink = (
  links: AcceptancePullRequestLink[] | undefined,
  parsed: ParsedChangeRequestUrl,
  title: string | undefined,
  now = new Date(),
): AcceptancePullRequestLink[] => {
  const key = identity(parsed);
  const existing = links?.find((link) => identity(link) === key);
  const next: AcceptancePullRequestLink = {
    linkedAt: existing?.linkedAt ?? now.toISOString(),
    number: parsed.number,
    provider: parsed.provider,
    repoFullName: parsed.repoFullName,
    title: title ?? existing?.title,
    url: parsed.url,
  };
  return [...(links ?? []).filter((link) => identity(link) !== key), next];
};

/** Drop a hand link; `null` when the acceptance had none for this PR. */
export const removePullRequestLink = (
  links: AcceptancePullRequestLink[] | undefined,
  parsed: ParsedChangeRequestUrl,
): AcceptancePullRequestLink[] | null => {
  const key = identity(parsed);
  if (!links?.some((link) => identity(link) === key)) return null;
  return links.filter((link) => identity(link) !== key);
};

export interface AcceptancePullRequest {
  ciStatus: ScmCiStatus | null;
  isDraft: boolean;
  mergedAt: Date | null;
  number: number;
  provider: string;
  repoFullName: string;
  reviewDecision: ScmReviewDecision | null;
  /** `provider`: a verified provider row; `manual`: a hand link nothing has vouched for. */
  source: 'manual' | 'provider';
  /** `null` for a hand link: no provider has reported its lifecycle to this acceptance. */
  state: ScmChangeRequestState | null;
  title: string | null;
  url: string;
}

/**
 * The pull requests that deliver an acceptance: provider-verified rows linked
 * to it, then hand links no verified row already covers. Provider facts only —
 * topic, task and installation links are the owner's plumbing, and a public
 * acceptance is readable by anyone holding its URL.
 */
export const listAcceptancePullRequests = (
  rows: ScmChangeRequestItem[],
  links: AcceptancePullRequestLink[] | undefined,
): AcceptancePullRequest[] => {
  const verified = rows.map((row): AcceptancePullRequest => ({
    ciStatus: row.ciStatus,
    isDraft: row.isDraft,
    mergedAt: row.mergedAt,
    number: row.number,
    provider: row.provider,
    repoFullName: row.repoFullName,
    reviewDecision: row.reviewDecision,
    source: 'provider',
    state: row.state,
    title: row.title,
    url: row.url,
  }));
  const covered = new Set(verified.map(identity));
  const manual = (links ?? [])
    .filter((link) => !covered.has(identity(link)))
    .map((link): AcceptancePullRequest => ({
      ciStatus: null,
      isDraft: false,
      mergedAt: null,
      number: link.number,
      provider: link.provider,
      repoFullName: link.repoFullName,
      reviewDecision: null,
      source: 'manual',
      state: null,
      title: link.title ?? null,
      url: link.url,
    }));
  return [...verified, ...manual];
};
