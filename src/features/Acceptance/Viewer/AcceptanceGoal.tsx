'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronsDownUp, ChevronsUpDown, GitBranch, GitCommitHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useLocalStorageState } from '@/hooks/useLocalStorageState';

import { useAcceptanceScope } from './AcceptanceScope';
import { acceptanceCodingScope } from './codingScope';
import { useAcceptanceBundle } from './useAcceptanceBundle';

const GOAL_COLLAPSED_STORAGE_KEY = 'lobehub-acceptance-goal-collapsed';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};

    &:hover [data-goal-toggle='true'] {
      pointer-events: auto;
      opacity: 1;
    }
  `,
  goalToggle: css`
    pointer-events: none;
    opacity: 0;
    transition: opacity ${cssVar.motionDurationMid};

    &:focus-visible {
      pointer-events: auto;
      opacity: 1;
    }

    @media (hover: none) {
      pointer-events: auto;
      opacity: 1;
    }
  `,
  requirementLabel: css`
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
    letter-spacing: 0.04em;
  `,
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
  summaryClamp: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;

    line-height: 1.6;
  `,
  viewReportLink: css`
    cursor: pointer;
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};

    &:hover {
      color: ${cssVar.colorTextSecondary};
    }
  `,
}));

interface AcceptanceGoalProps {
  editSlot?: ReactNode;
  reportSlot?: ReactNode;
}

const AcceptanceGoal = ({ editSlot, reportSlot }: AcceptanceGoalProps) => {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useAcceptanceScope();
  const { data } = useAcceptanceBundle(acceptanceId);
  const [collapsed, setCollapsed] = useLocalStorageState(GOAL_COLLAPSED_STORAGE_KEY, false);
  if (!data) return null;

  const requirement = data.acceptance.requirement;
  const latestSummary = data.latestReport?.summary;
  const currentRound = data.rounds.at(-1);
  const roundLabel = currentRound
    ? t('acceptance.round', { round: currentRound.run.roundIndex })
    : undefined;
  const scope = acceptanceCodingScope(data.rounds);
  const emptyLabel = editSlot
    ? t('acceptance.requirementEmptyEditable')
    : t('acceptance.requirementEmpty');
  const showContext = Boolean(latestSummary || scope);

  return (
    <Flexbox
      className={styles.card}
      gap={collapsed ? 0 : 12}
      paddingBlock={collapsed ? 8 : 12}
      paddingInline={collapsed ? 12 : 16}
    >
      <Flexbox horizontal align={'center'} gap={4}>
        <Text className={styles.requirementLabel}>{t('acceptance.requirementLabel')}</Text>
        {!collapsed && editSlot}
        {collapsed && (
          <Text
            ellipsis
            fontSize={13}
            style={{ flex: 1, minWidth: 0 }}
            title={requirement ?? emptyLabel}
          >
            {requirement ?? emptyLabel}
          </Text>
        )}
        {!collapsed && <Flexbox flex={1} />}
        <ActionIcon
          data-goal-toggle
          className={styles.goalToggle}
          icon={collapsed ? ChevronsUpDown : ChevronsDownUp}
          size={'small'}
          title={t(collapsed ? 'acceptance.goalExpand' : 'acceptance.goalCollapse')}
          onClick={() => setCollapsed((value) => !value)}
        />
      </Flexbox>
      {!collapsed &&
        (requirement ? (
          <Text style={{ fontSize: 15, lineHeight: 1.7 }}>{requirement}</Text>
        ) : (
          <Text style={{ fontSize: 15, lineHeight: 1.7 }}>{emptyLabel}</Text>
        ))}
      {!collapsed && showContext && (
        <Flexbox
          gap={8}
          paddingBlock={'12px 0'}
          style={{ borderBlockStart: `1px solid ${cssVar.colorBorderSecondary}` }}
        >
          <Flexbox horizontal align={'center'} gap={8}>
            <Text fontSize={12} type={'secondary'}>
              {t('acceptance.latestSummary')}
              {roundLabel ? ` · ${roundLabel}` : ''}
            </Text>
            <Flexbox flex={1} />
            {reportSlot}
          </Flexbox>
          {latestSummary && (
            <Text className={styles.summaryClamp} fontSize={13} type={'secondary'}>
              {latestSummary}
            </Text>
          )}
          {scope && (
            <Flexbox horizontal align={'center'} gap={16} wrap={'wrap'}>
              {scope.branch && (
                <Flexbox horizontal align={'center'} className={styles.scopeChip} gap={4}>
                  <Icon icon={GitBranch} size={13} /> {scope.branch}
                </Flexbox>
              )}
              {scope.commit && (
                <Flexbox horizontal align={'center'} className={styles.scopeChip} gap={4}>
                  <Icon icon={GitCommitHorizontal} size={13} /> {scope.commit.slice(0, 10)}
                </Flexbox>
              )}
            </Flexbox>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default AcceptanceGoal;
