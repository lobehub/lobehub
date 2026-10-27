import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
  Center,
  Flexbox,
  Icon,
  Text,
} from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import {
  type ExecutionStatusVisual,
  TOPIC_GROUP_VISUALS,
  TOPIC_STATUS_VISUALS,
} from '@/components/ExecutionStatus';

import TopicItem from '../../List/Item';
import { useTopicListScope } from '../../TopicListScope';
import { type GroupItemComponentProps } from '../GroupedAccordion';

// Status-group ids map 1:1 to a topic status except the synthetic `favorite`
// and `pending` buckets — all visuals come from the shared execution-status
// set so group headers, topic rows and task surfaces stay consistent.
const STATUS_ICON: Record<string, ExecutionStatusVisual> = {
  ...TOPIC_STATUS_VISUALS,
  ...TOPIC_GROUP_VISUALS,
};

const GroupItem = memo<GroupItemComponentProps>(({ group }) => {
  const { id, title, children } = group;
  const statusIcon = STATUS_ICON[id];
  // An agent's own status buckets mix topics from different projects, so each
  // row names its directory; inside a project that line repeats the project.
  const scope = useTopicListScope();

  return (
    <AccordionItem value={id}>
      <AccordionHeader>
        <AccordionTrigger style={{ paddingBlock: 4, paddingInline: '8px 4px' }}>
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
        </AccordionTrigger>
      </AccordionHeader>
      <AccordionPanel contentStyle={{ padding: 0 }}>
        <Flexbox gap={1} paddingBlock={1}>
          {children.map((topic) => (
            <TopicItem
              fav={topic.favorite}
              id={topic.id}
              key={topic.id}
              metadata={topic.metadata}
              runStartedAt={topic.runStartedAt}
              showWorkingDirectory={!scope}
              status={topic.status}
              title={topic.title}
              userId={topic.userId}
            />
          ))}
        </Flexbox>
      </AccordionPanel>
    </AccordionItem>
  );
}, isEqual);

GroupItem.displayName = 'TopicByStatusGroupItem';

export default GroupItem;
