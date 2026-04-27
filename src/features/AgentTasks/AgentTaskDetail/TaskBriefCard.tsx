import { Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

import BriefCardActions from '@/features/DailyBrief/BriefCardActions';
import BriefCardSummary from '@/features/DailyBrief/BriefCardSummary';
import BriefIcon from '@/features/DailyBrief/BriefIcon';
import { styles as briefStyles } from '@/features/DailyBrief/style';
import type { BriefItem } from '@/features/DailyBrief/types';
import Time from '@/routes/(main)/home/features/components/Time';

interface TaskBriefCardProps {
  brief: BriefItem;
  onAfterAddComment?: () => void | Promise<void>;
  onAfterResolve?: () => void | Promise<void>;
}

const TaskBriefCard = memo<TaskBriefCardProps>(({ brief, onAfterResolve, onAfterAddComment }) => {
  return (
    <Block
      className={briefStyles.card}
      gap={12}
      padding={12}
      style={{ borderRadius: cssVar.borderRadiusLG }}
      variant={'outlined'}
    >
      <Flexbox horizontal align={'center'} gap={8} style={{ overflow: 'hidden' }}>
        <BriefIcon size={20} type={brief.type} />
        <Text ellipsis style={{ flex: 1 }} weight={500}>
          {brief.title}
        </Text>
        <Time date={brief.createdAt} />
      </Flexbox>
      <BriefCardSummary summary={brief.summary} />
      <BriefCardActions
        actions={brief.actions}
        briefId={brief.id}
        briefType={brief.type}
        resolvedAction={brief.resolvedAction}
        taskId={brief.taskId}
        onAfterAddComment={onAfterAddComment}
        onAfterResolve={onAfterResolve}
      />
    </Block>
  );
});

export default TaskBriefCard;
