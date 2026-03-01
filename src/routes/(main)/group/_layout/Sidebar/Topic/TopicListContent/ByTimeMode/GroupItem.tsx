import { AccordionItem, Flexbox, Icon, Text } from '@lobehub/ui';
import dayjs from 'dayjs';
import { HashIcon } from 'lucide-react';
import React, { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type GroupedTopic } from '@/types/topic';

import TopicItem from '../../List/Item';

const preformat = (id: string) =>
  id.startsWith('20') ? (id.includes('-') ? dayjs(id).format('MMMM') : id) : undefined;

interface GroupItemProps {
  activeThreadId?: string;
  activeTopicId?: string;
  group: GroupedTopic;
}

const GroupItem = memo<GroupItemProps>(({ group, activeTopicId, activeThreadId }) => {
  const { t } = useTranslation('topic');
  const { id, title, children } = group;

  const timeTitle = useMemo(() => preformat(id) ?? t(`groupTitle.byTime.${id}` as any), [id, t]);

  return (
    <AccordionItem
      itemKey={id}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      title={
        <Flexbox horizontal align="center" gap={6} height={24} style={{ overflow: 'hidden' }}>
          <Icon icon={HashIcon} style={{ opacity: 0.5 }} />
          <Text ellipsis fontSize={12} style={{ flex: 1 }} type={'secondary'} weight={500}>
            {title || timeTitle}
          </Text>
        </Flexbox>
      }
    >
      <Flexbox gap={1} paddingBlock={1}>
        {children.map((topic) => (
          <TopicItem
            active={activeTopicId === topic.id}
            fav={topic.favorite}
            id={topic.id}
            key={topic.id}
            threadId={activeThreadId}
            title={topic.title}
          />
        ))}
      </Flexbox>
    </AccordionItem>
  );
});

export default GroupItem;
