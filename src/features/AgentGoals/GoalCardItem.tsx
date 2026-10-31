'use client';

import { Block, ContextMenuTrigger, createStaticStyles, cssVar, Flexbox, Text } from '@lobehub/ui';
import type { KeyboardEvent } from 'react';
import { memo } from 'react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';

import GoalAgentLabel from './GoalAgentLabel';
import GoalItemMoreButton from './GoalItemMoreButton';
import { goalItemPath } from './goalItemPath';
import GoalPrivateMark from './GoalPrivateMark';
import { GoalProgress } from './GoalProgress';
import GoalStatusGlyph from './GoalStatusGlyph';
import type { GoalItemProps } from './types';
import { useGoalItemMenu } from './useGoalMenuItems';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    min-width: 0;
    transition:
      border-color 0.2s ${cssVar.motionEaseOut},
      background 0.2s ${cssVar.motionEaseOut},
      transform 0.2s ${cssVar.motionEaseOut};

    &:hover,
    &[data-popup-open] {
      transform: translateY(-1px);
      border-color: ${cssVar.colorPrimaryBorder};
      background: ${cssVar.colorFillQuaternary};
    }
  `,
}));

export const GoalCardItem = memo<GoalItemProps>(({ globalScopeId, goal: item, projectId }) => {
  const navigate = useWorkspaceAwareNavigate();
  const { aid } = useActiveRouteParams<{ aid?: string }>();
  const { goal } = item;
  // On the project Goals page there is no `aid` in the route, and a goal created
  // there has no responsible agent either — so fall back the same way tasks do,
  // to the bare detail route. Without this every card there is a dead link.
  const agentId = aid ?? goal.agentId;
  const handleClick = () => {
    navigate(goalItemPath({ agentId, crossAgent: !!globalScopeId, goalId: goal.id }));
  };
  const menuItems = useGoalItemMenu({
    agentId,
    globalScopeId,
    goal,
    projectId,
    routeAgentId: aid,
  });
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleClick();
  };

  return (
    <ContextMenuTrigger items={menuItems}>
      <Block
        clickable
        className={styles.card}
        gap={12}
        padding={16}
        role={'link'}
        tabIndex={0}
        variant={'outlined'}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        <Flexbox horizontal align={'flex-start'} gap={12} justify={'space-between'}>
          <Flexbox gap={4} style={{ minWidth: 0 }}>
            <Flexbox horizontal align={'center'} gap={7}>
              <GoalStatusGlyph size={13} status={goal.status} />
              <Text ellipsis fontSize={15} weight={600}>
                {goal.title}
              </Text>
              <GoalPrivateMark goal={goal} />
            </Flexbox>
            {goal.requirement && goal.requirement !== goal.title && (
              <Text ellipsis fontSize={12} type={'secondary'}>
                {goal.requirement}
              </Text>
            )}
          </Flexbox>
          <GoalItemMoreButton items={menuItems} />
        </Flexbox>
        {/* Its own line: a card is too narrow to hold the label beside the
          progress grid without pushing the grid past the card's edge. */}
        {globalScopeId && <GoalAgentLabel agentId={goal.agentId} />}
        <GoalProgress
          pendingDecisions={item.pendingDecisions}
          taskDone={item.taskDone}
          taskTotal={item.taskTotal}
          totalRunCost={item.totalRunCost}
          totalRunDuration={item.totalRunDuration}
        />
      </Block>
    </ContextMenuTrigger>
  );
});

GoalCardItem.displayName = 'GoalCardItem';
