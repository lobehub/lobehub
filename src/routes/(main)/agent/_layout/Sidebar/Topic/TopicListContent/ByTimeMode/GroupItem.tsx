import { AccordionItem, Flexbox, Text } from '@lobehub/ui';
import dayjs from 'dayjs';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import TopicItem from '../../List/Item';
import { type GroupItemComponentProps } from '../GroupedAccordion';

const preformat = (id: string) =>
  id.startsWith('20') ? (id.includes('-') ? dayjs(id).format('MMMM') : id) : undefined;

const GroupItem = memo<GroupItemComponentProps>(({ group, activeTopicId, activeThreadId }) => {
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
            metadata={topic.metadata}
            status={topic.status}
            threadId={activeThreadId}
            title={topic.title}
          />
        ))}
      </Flexbox>
    </AccordionItem>
  );
});

export default GroupItem;
