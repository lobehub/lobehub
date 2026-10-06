'use client';

import type { VerifyCodingPullRequest } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  type LucideIcon,
} from 'lucide-react';
import { memo } from 'react';

import type { AcceptanceBundle } from '@/services/verify';

const styles = createStaticStyles(({ css }) => ({
  link: css`
    cursor: pointer;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
      text-decoration: underline;
    }
  `,
}));

type PullRequest = AcceptanceBundle['pullRequests'][number];

const stateIcon = (pullRequest: PullRequest): { color?: string; icon: LucideIcon } => {
  if (pullRequest.state === 'merged') return { color: cssVar.purple, icon: GitMerge };
  if (pullRequest.state === 'closed')
    return { color: cssVar.colorError, icon: GitPullRequestClosed };
  if (pullRequest.isDraft) return { icon: GitPullRequestDraft };
  // A hand link nobody has reported a lifecycle for: no colour to claim.
  if (!pullRequest.state) return { icon: GitPullRequest };
  return { color: cssVar.colorSuccess, icon: GitPullRequest };
};

interface PullRequestLinksProps {
  /** What a round recorded at ingest; only shown for acceptances with no linked pull request. */
  fallback?: VerifyCodingPullRequest;
  pullRequests: AcceptanceBundle['pullRequests'];
}

/**
 * The pull requests that deliver this acceptance. Stacked pull requests share
 * one acceptance, so this is a list; each carries its lifecycle in its icon,
 * the way GitHub draws it, because "is it merged yet" is the question a
 * reader brings to this row.
 */
const PullRequestLinks = memo<PullRequestLinksProps>(({ pullRequests, fallback }) => {
  if (pullRequests.length > 0)
    return (
      <>
        {pullRequests.map((pullRequest) => {
          const { color, icon } = stateIcon(pullRequest);
          return (
            <a
              className={styles.link}
              href={pullRequest.url}
              key={pullRequest.url}
              rel={'noreferrer'}
              target={'_blank'}
              title={
                pullRequest.title
                  ? `${pullRequest.repoFullName}#${pullRequest.number} ${pullRequest.title}`
                  : `${pullRequest.repoFullName}#${pullRequest.number}`
              }
            >
              <Flexbox horizontal align={'center'} gap={4}>
                <Icon color={color} icon={icon} size={13} /> #{pullRequest.number}
              </Flexbox>
            </a>
          );
        })}
      </>
    );

  if (!fallback?.number) return null;
  const label = (
    <Flexbox horizontal align={'center'} gap={4}>
      <Icon icon={GitPullRequest} size={13} /> #{fallback.number}
    </Flexbox>
  );
  return fallback.url ? (
    <a
      className={styles.link}
      href={fallback.url}
      rel={'noreferrer'}
      target={'_blank'}
      title={fallback.title ?? fallback.url}
    >
      {label}
    </a>
  ) : (
    label
  );
});

PullRequestLinks.displayName = 'PullRequestLinks';

export default PullRequestLinks;
