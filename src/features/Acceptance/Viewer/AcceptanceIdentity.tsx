'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Avatar, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import dayjs from 'dayjs';
import { GitPullRequest } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsHydrated } from '@/hooks/useIsHydrated';

import { useAcceptanceScope } from './AcceptanceScope';
import AcceptanceStatusPill from './AcceptanceStatusPill';
import { acceptanceCodingScope } from './codingScope';
import { useAcceptanceBundle } from './useAcceptanceBundle';
import { formatAcceptanceCountsText } from './verdict';

const styles = createStaticStyles(({ css }) => ({
  scopeChip: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  scopeLink: css`
    cursor: pointer;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
      text-decoration: underline;
    }
  `,
}));

interface AcceptanceIdentityProps {
  /** Rendered on the meta line — the per-check entry point. */
  focusSlot?: ReactNode;
  statusSlot?: ReactNode;
  topicSlot?: ReactNode;
}

/**
 * Identity, state and provenance in two lines.
 *
 * They used to take four: the status pill led a line of its own, the title a
 * second, the per-check entry a third and the provenance chips a fourth — so
 * the delivery's name, the one thing you scan for, sat in the middle of a
 * stack of qualifiers. Now the title anchors line one with its state beside
 * it, and everything that merely QUALIFIES it (counts, when it last ran, where
 * it came from, how to open it check by check) collapses onto one meta line
 * underneath.
 */

const AcceptanceIdentity = ({ focusSlot, statusSlot, topicSlot }: AcceptanceIdentityProps) => {
  const { t } = useTranslation('verify');
  const hydrated = useIsHydrated();
  const { acceptanceId, embedded } = useAcceptanceScope();
  const { data } = useAcceptanceBundle(acceptanceId);
  if (!data) return null;

  const { acceptance, checks, origin, rounds, subject } = data;
  const currentRound = rounds.at(-1);
  const scope = acceptanceCodingScope(rounds);
  const pullRequest = scope?.pullRequest;
  const countsText = formatAcceptanceCountsText(t, {
    failed: checks.filter((check) => check.state === 'failed').length,
    notExecuted: checks.filter((check) => check.state === 'not_executed').length,
    passed: checks.filter((check) => check.state === 'passed').length,
    uncertain: checks.filter((check) => check.state === 'uncertain').length,
  });
  const latestAt =
    hydrated && currentRound
      ? t('acceptance.verdict.latestAt', {
          time: dayjs(currentRound.run.createdAt).format('MM-DD HH:mm'),
        })
      : undefined;
  const originAgent = embedded ? null : origin?.agent;
  const showOrigin = Boolean(originAgent || topicSlot || pullRequest?.number);

  return (
    <Flexbox gap={6}>
      {/* State leads, on its own line above the name — the delivery's standing
          is what a reader checks first, and it stops competing with the title
          for the same row. The per-check entry rides along with it: it acts on
          exactly the counts stated beside it. */}
      <Flexbox horizontal align={'center'} gap={10} wrap={'wrap'}>
        {statusSlot ?? <AcceptanceStatusPill status={acceptance.status} />}
        <Text fontSize={12} type={'secondary'}>
          {[countsText, latestAt].filter(Boolean).join(' · ')}
        </Text>
        {focusSlot}
      </Flexbox>

      {/* No subject-type tag beside the name. Which KIND of thing was
          delivered is a fact about the plumbing, not about the delivery a
          reader came to judge — and it sat where the title's own meaning
          should carry. */}
      <Flexbox horizontal align={'center'} gap={10} wrap={'wrap'}>
        <Text ellipsis as={'h1'} style={{ fontSize: 18, margin: 0, minWidth: 0 }}>
          {subject.title ?? subject.id}
        </Text>
      </Flexbox>

      {showOrigin && (
        <Flexbox horizontal align={'center'} gap={16} wrap={'wrap'}>
          {originAgent && (
            <Flexbox
              horizontal
              align={'center'}
              className={styles.scopeChip}
              gap={6}
              style={{ cursor: 'default', fontSize: 14 }}
            >
              <Avatar
                avatar={originAgent.avatar ?? undefined}
                background={originAgent.backgroundColor ?? undefined}
                size={18}
              />
              {originAgent.title ?? t('acceptance.origin.agentFallback')}
            </Flexbox>
          )}
          {topicSlot}
          {pullRequest?.number ? (
            pullRequest.url ? (
              <a
                className={cx(styles.scopeChip, styles.scopeLink)}
                href={pullRequest.url}
                rel={'noreferrer'}
                target={'_blank'}
                title={pullRequest.title ?? pullRequest.url}
              >
                <Flexbox horizontal align={'center'} gap={4}>
                  <Icon icon={GitPullRequest} size={13} /> #{pullRequest.number}
                </Flexbox>
              </a>
            ) : (
              <Flexbox horizontal align={'center'} className={styles.scopeChip} gap={4}>
                <Icon icon={GitPullRequest} size={13} /> #{pullRequest.number}
              </Flexbox>
            )
          ) : null}
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default AcceptanceIdentity;
