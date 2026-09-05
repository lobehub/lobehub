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
  /**
   * No border, no card. The requirement is the page's own subject line, not a
   * widget parked on it — boxing it added a frame around the one thing nobody
   * needs help finding.
   */
  card: css`
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
}

const AcceptanceGoal = ({ editSlot }: AcceptanceGoalProps) => {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useAcceptanceScope();
  const { data } = useAcceptanceBundle(acceptanceId);
  const [collapsed, setCollapsed] = useLocalStorageState(GOAL_COLLAPSED_STORAGE_KEY, false);
  if (!data) return null;

  const requirement = data.acceptance.requirement;
  const scope = acceptanceCodingScope(data.rounds);
  const emptyLabel = editSlot
    ? t('acceptance.requirementEmptyEditable')
    : t('acceptance.requirementEmpty');

  return (
    <Flexbox className={styles.card} gap={collapsed ? 0 : 6}>
      {/* No "Acceptance goal" label: the sentence under the title IS the goal,
          and naming it added a caption to a paragraph that reads fine alone.
          Its controls therefore ride the sentence's own row — a header strip
          with nothing left to say is just an empty band of space. */}
      <Flexbox horizontal align={collapsed ? 'center' : 'flex-start'} gap={4}>
        <Text
          ellipsis={collapsed}
          title={collapsed ? (requirement ?? emptyLabel) : undefined}
          style={{
            flex: 1,
            fontSize: collapsed ? 13 : 15,
            lineHeight: collapsed ? undefined : 1.7,
            minWidth: 0,
          }}
        >
          {requirement ?? emptyLabel}
        </Text>
        {!collapsed && editSlot}
        <ActionIcon
          data-goal-toggle
          className={styles.goalToggle}
          icon={collapsed ? ChevronsUpDown : ChevronsDownUp}
          size={'small'}
          title={t(collapsed ? 'acceptance.goalExpand' : 'acceptance.goalCollapse')}
          onClick={() => setCollapsed((value) => !value)}
        />
      </Flexbox>
      {!collapsed && scope && (
        <Flexbox gap={8}>
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
