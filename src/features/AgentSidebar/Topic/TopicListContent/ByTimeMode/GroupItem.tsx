import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
  Flexbox,
  Text,
} from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import SectionTitle, { useSectionTriggerStyle } from '@/features/NavPanel/components/SectionTitle';

import TopicItem from '../../List/Item';
import { type GroupItemComponentProps } from '../GroupedAccordion';
import { formatTimeGroupId } from './timeGroupTitle';

const GroupItem = memo<GroupItemComponentProps>(({ group }) => {
  const sectionTriggerStyle = useSectionTriggerStyle();
  const { t } = useTranslation('topic');
  const { id, title, children } = group;

  const timeTitle = useMemo(
    () => formatTimeGroupId(id) ?? t(`groupTitle.byTime.${id}` as any),
    [id, t],
  );

  return (
    <AccordionItem value={id}>
      <AccordionHeader>
        <AccordionTrigger style={sectionTriggerStyle}>
          <Flexbox horizontal align="center" gap={6} height={24} style={{ overflow: 'hidden' }}>
            <Flexbox flex={1} style={{ minWidth: 0 }}>
              <SectionTitle>{title || timeTitle}</SectionTitle>
            </Flexbox>
          </Flexbox>
        </AccordionTrigger>
      </AccordionHeader>
      <AccordionPanel contentStyle={{ padding: 0 }}>
        <Flexbox gap={1} paddingBlock={1}>
          {children.map((topic) => (
            <TopicItem
              fav={topic.favorite}
              hasGoal={topic.hasGoal}
              id={topic.id}
              key={topic.id}
              metadata={topic.metadata}
              runStartedAt={topic.runStartedAt}
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

GroupItem.displayName = 'TopicByTimeGroupItem';

export default GroupItem;
