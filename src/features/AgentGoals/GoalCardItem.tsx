'use client';

import { Block, Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowRightIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { memo } from 'react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';

import { GoalProgress } from './GoalProgress';
import GoalStatusGlyph from './GoalStatusGlyph';
import type { GoalItemProps } from './types';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    min-width: 0;
    transition:
      border-color 0.2s ${cssVar.motionEaseOut},
      background 0.2s ${cssVar.motionEaseOut},
      transform 0.2s ${cssVar.motionEaseOut};

    &:hover {
      transform: translateY(-1px);
      border-color: ${cssVar.colorPrimaryBorder};
      background: ${cssVar.colorFillQuaternary};
    }
  `,
}));

export const GoalCardItem = memo<GoalItemProps>(({ goal: item }) => {
  const navigate = useWorkspaceAwareNavigate();
  const { aid } = useActiveRouteParams<{ aid?: string }>();
  const { goal } = item;
  // On the project Goals page there is no `aid` in the route, and a goal created
  // there has no responsible agent either — so fall back the same way tasks do,
  // to the bare detail route. Without this every card there is a dead link.
  const agentId = aid ?? goal.agentId;
  const handleClick = () => {
    navigate(agentId ? `/agent/${agentId}/goal/${goal.id}` : `/goal/${goal.id}`);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleClick();
  };

  return (
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
          </Flexbox>
          {goal.requirement && goal.requirement !== goal.title && (
            <Text ellipsis fontSize={12} type={'secondary'}>
              {goal.requirement}
            </Text>
          )}
        </Flexbox>
        <Icon color={cssVar.colorTextQuaternary} icon={ArrowRightIcon} size={16} />
      </Flexbox>
      <GoalProgress
        findingCount={item.findingCount}
        pendingDecisions={item.pendingDecisions}
        totalRunCost={item.totalRunCost}
        totalRunDuration={item.totalRunDuration}
        workDone={item.workDone}
        workTotal={item.workTotal}
      />
    </Block>
  );
});

GoalCardItem.displayName = 'GoalCardItem';
