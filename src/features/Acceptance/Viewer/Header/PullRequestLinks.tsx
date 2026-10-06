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

type ChangeRequest = AcceptanceBundle['changeRequests'][number];

const stateIcon = (changeRequest: ChangeRequest): { color?: string; icon: LucideIcon } => {
  if (changeRequest.state === 'merged') return { color: cssVar.purple, icon: GitMerge };
  if (changeRequest.state === 'closed')
    return { color: cssVar.colorError, icon: GitPullRequestClosed };
  if (changeRequest.isDraft) return { icon: GitPullRequestDraft };
  return { color: cssVar.colorSuccess, icon: GitPullRequest };
};

interface PullRequestLinksProps {
  changeRequests: AcceptanceBundle['changeRequests'];
  /** What a round recorded at ingest; only shown for acceptances with no linked pull request. */
  fallback?: VerifyCodingPullRequest;
}

/**
 * The pull requests that deliver this acceptance. Stacked pull requests share
 * one acceptance, so this is a list; each carries its lifecycle in its icon,
 * the way GitHub draws it, because "is it merged yet" is the question a
 * reader brings to this row.
 */
const PullRequestLinks = memo<PullRequestLinksProps>(({ changeRequests, fallback }) => {
  if (changeRequests.length > 0)
    return (
      <>
        {changeRequests.map((changeRequest) => {
          const { color, icon } = stateIcon(changeRequest);
          return (
            <a
              className={styles.link}
              href={changeRequest.url}
              key={changeRequest.id}
              rel={'noreferrer'}
              target={'_blank'}
              title={
                changeRequest.title
                  ? `${changeRequest.repoFullName}#${changeRequest.number} ${changeRequest.title}`
                  : `${changeRequest.repoFullName}#${changeRequest.number}`
              }
            >
              <Flexbox horizontal align={'center'} gap={4}>
                <Icon color={color} icon={icon} size={13} /> #{changeRequest.number}
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
