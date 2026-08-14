'use client';

import type { TaskStatus } from '@lobechat/types';
import { ActionIcon, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowRightIcon, RefreshCwIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { TASK_STATUS_VISUALS } from '@/components/ExecutionStatus';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';

import { GoalAcceptance } from './GoalAcceptance';
import { getGoalPresentation } from './goalPresentation';
import { GoalProgress } from './GoalProgress';
import { getGoalDescription, goalStatusToTaskStatus, shouldShowGoal } from './goalViewModel';
import type { GoalItemProps } from './types';

const styles = createStaticStyles(({ css }) => ({
  row: css`
    min-width: 0;
    border-radius: 0;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
}));

export const GoalListItem = memo<GoalItemProps>((props) => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const { aid } = useActiveRouteParams<{ aid?: string }>();
  const { hideAchieved = false, projectId, task } = props;
  const config = task.config as { goal?: { maxIterations?: number | null } } | null;
  const title = task.name?.trim() || task.instruction.trim() || task.identifier;
  const description = getGoalDescription(task);
  const handleClick = () => {
    if (projectId) navigate(`/task/${task.identifier}`);
    else if (aid) navigate(`/agent/${aid}/goal/${task.identifier}`);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleClick();
  };

  return (
    <GoalAcceptance taskId={task.id}>
      {({ bundle, error, isLoading, retry }) => {
        const presentation = getGoalPresentation({
          acceptanceStatus: bundle?.acceptance.status,
          checks: bundle?.checks,
          maxRounds: config?.goal?.maxIterations,
          rounds: task.totalTopics ?? 0,
          taskStatus: task.status,
        });
        if (!isLoading && !shouldShowGoal(presentation.statusKey, hideAchieved ? 'active' : 'all'))
          return null;
        const visual =
          TASK_STATUS_VISUALS[goalStatusToTaskStatus(presentation.statusKey) as TaskStatus] ??
          TASK_STATUS_VISUALS.backlog;

        return (
          <Block
            clickable
            horizontal
            align={'center'}
            className={styles.row}
            gap={12}
            justify={'space-between'}
            paddingBlock={10}
            paddingInline={0}
            role={'link'}
            tabIndex={0}
            variant={'borderless'}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
          >
            <Flexbox
              horizontal
              align={'center'}
              flex={1}
              gap={12}
              justify={'space-between'}
              style={{ minWidth: 0 }}
            >
              <Flexbox gap={4} style={{ minWidth: 0 }}>
                <Flexbox horizontal align={'center'} gap={7}>
                  <Icon
                    color={visual.color}
                    icon={visual.icon}
                    size={13}
                    style={{ flexShrink: 0 }}
                  />
                  <Text ellipsis fontSize={15} weight={600}>
                    {title}
                  </Text>
                </Flexbox>
                {description && description !== title && (
                  <Text ellipsis fontSize={12} type={'secondary'}>
                    {description}
                  </Text>
                )}
              </Flexbox>
            </Flexbox>
            <GoalProgress
              isLoading={isLoading}
              presentation={presentation}
              totalRunCost={props.task.totalRunCost}
              totalRunDuration={props.task.totalRunDuration}
              totalRuns={props.task.totalTopics}
            />
            {error ? (
              <ActionIcon
                icon={RefreshCwIcon}
                size={'small'}
                title={t('goalList.retry')}
                onClick={(event) => {
                  event.stopPropagation();
                  retry();
                }}
              />
            ) : (
              <Icon color={cssVar.colorTextQuaternary} icon={ArrowRightIcon} size={16} />
            )}
          </Block>
        );
      }}
    </GoalAcceptance>
  );
});

GoalListItem.displayName = 'GoalListItem';
