import { AccordionItem, Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { memo } from 'react';

import {
  type ExecutionStatusVisual,
  TOPIC_GROUP_VISUALS,
  TOPIC_STATUS_VISUALS,
} from '@/components/ExecutionStatus';

import TopicItem from '../../List/Item';
import { type GroupItemComponentProps } from '../GroupedAccordion';

// Status-group ids map 1:1 to a topic status except the synthetic `favorite`
// and `pending` buckets — all visuals come from the shared execution-status
// set so group headers, topic rows and task surfaces stay consistent.
const STATUS_ICON: Record<string, ExecutionStatusVisual> = {
  ...TOPIC_STATUS_VISUALS,
  ...TOPIC_GROUP_VISUALS,
};

const GroupItem = memo<GroupItemComponentProps>(({ group, activeTopicId, activeThreadId }) => {
  const { id, title, children } = group;
  const statusIcon = STATUS_ICON[id];

  return (
    <AccordionItem
      itemKey={id}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      title={
        <Flexbox horizontal align="center" gap={6} height={24} style={{ overflow: 'hidden' }}>
          {statusIcon && (
            <Center flex={'none'} height={16} width={16}>
              <Icon color={statusIcon.color} icon={statusIcon.icon} size={{ size: 13 }} />
            </Center>
          )}
          <Text ellipsis fontSize={12} style={{ flex: 1 }} type={'secondary'} weight={500}>
            {title}
          </Text>
        </Flexbox>
      }
    >
      <Flexbox gap={1} paddingBlock={1}>
        {children.map((topic) => (
          <TopicItem
            showWorkingDirectory
            active={activeTopicId === topic.id}
            fav={topic.favorite}
            id={topic.id}
            key={topic.id}
            metadata={topic.metadata}
            status={topic.status}
            threadId={activeThreadId}
            title={topic.title}
            userId={topic.userId}
          />
        ))}
      </Flexbox>
    </AccordionItem>
  );
});

export default GroupItem;
