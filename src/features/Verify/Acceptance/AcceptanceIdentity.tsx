'use client';

import { Avatar, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
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
  statusSlot?: ReactNode;
  topicSlot?: ReactNode;
}

const AcceptanceIdentity = ({ statusSlot, topicSlot }: AcceptanceIdentityProps) => {
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
    <Flexbox gap={10}>
      <Flexbox horizontal align={'center'} gap={10} wrap={'wrap'}>
        {statusSlot ?? <AcceptanceStatusPill status={acceptance.status} />}
        <Text fontSize={12} type={'secondary'}>
          {[countsText, latestAt].filter(Boolean).join(' · ')}
        </Text>
      </Flexbox>

      <Flexbox horizontal align={'center'} gap={10}>
        <Text as={'h1'} style={{ fontSize: 18, margin: 0 }}>
          {subject.title ?? subject.id}
        </Text>
        <Tag size={'small'}>{t(`acceptance.subject.${subject.type}`)}</Tag>
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
