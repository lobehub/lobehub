'use client';

import { Block, ContextMenuTrigger, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

const HOVERED = ':is(:hover, [data-popup-open])';
const styles = stylex.create({
  row: {
    flexWrap: { 'default': null, '@media (width <= 767px)': 'wrap' },
    rowGap: { 'default': null, '@media (width <= 767px)': '6px' },
    minWidth: 0,
    borderRadius: 0,
    borderBlockStartWidth: { default: null, [stylex.when.siblingBefore(':is(*)')]: '1px' },
    borderBlockStartStyle: { default: null, [stylex.when.siblingBefore(':is(*)')]: 'solid' },
    borderBlockStartColor: {
      default: null,
      [stylex.when.siblingBefore(':is(*)')]: cssVar.colorBorderSecondary,
    },
    backgroundColor: { default: null, [HOVERED]: cssVar.colorFillQuaternary },
    backgroundImage: { default: null, [HOVERED]: 'none' },
  },
  title: {
    flex: '1',
    minWidth: 0,
    flexBasis: { 'default': null, '@media (width <= 767px)': '100%' },
  },
});

export const GoalListItem = memo<GoalItemProps>(({ globalScopeId, goal: item, projectId }) => {
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
        horizontal
        align={'center'}
        className={stylex.props(styles.row, stylex.defaultMarker()).className}
        gap={12}
        justify={'space-between'}
        paddingBlock={10}
        paddingInline={12}
        role={'link'}
        tabIndex={0}
        variant={'borderless'}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        <Flexbox className={stylex.props(styles.title).className} gap={4}>
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
        {globalScopeId && <GoalAgentLabel agentId={goal.agentId} />}
        <GoalProgress
          pendingDecisions={item.pendingDecisions}
          taskDone={item.taskDone}
          taskTotal={item.taskTotal}
          totalRunCost={item.totalRunCost}
          totalRunDuration={item.totalRunDuration}
        />
        <GoalItemMoreButton items={menuItems} />
      </Block>
    </ContextMenuTrigger>
  );
});

GoalListItem.displayName = 'GoalListItem';
