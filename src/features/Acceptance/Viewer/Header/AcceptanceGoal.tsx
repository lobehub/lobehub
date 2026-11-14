'use client';

import { ActionIcon, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronsDownUp, ChevronsUpDown, GitBranch, GitCommitHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useLocalStorageState } from '@/hooks/useLocalStorageState';

import { useAcceptanceScope } from '../AcceptanceScope';
import { acceptanceCodingScope } from '../History/codingScope';
import { goalCardMarker } from '../markers.stylex';
import { useAcceptanceBundle } from '../useAcceptanceBundle';

const GOAL_COLLAPSED_STORAGE_KEY = 'lobehub-acceptance-goal-collapsed';

const styles = stylex.create({
  goalToggle: {
    pointerEvents: {
      'default': 'none',
      ':focus-visible': 'auto',
      '@media (hover: none)': 'auto',
      [stylex.when.ancestor(':hover', goalCardMarker)]: 'auto',
    },
    opacity: {
      'default': 0,
      ':focus-visible': 1,
      '@media (hover: none)': 1,
      [stylex.when.ancestor(':hover', goalCardMarker)]: 1,
    },
    transition: `opacity ${cssVar.motionDurationMid}`,
  },
  scopeChip: {
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
  },
});

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
    <Flexbox gap={collapsed ? 0 : 6} {...stylex.props(goalCardMarker)}>
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
          {...stylex.props(styles.goalToggle)}
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
                <Flexbox horizontal align={'center'} gap={4} {...stylex.props(styles.scopeChip)}>
                  <Icon icon={GitBranch} size={13} /> {scope.branch}
                </Flexbox>
              )}
              {scope.commit && (
                <Flexbox horizontal align={'center'} gap={4} {...stylex.props(styles.scopeChip)}>
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
