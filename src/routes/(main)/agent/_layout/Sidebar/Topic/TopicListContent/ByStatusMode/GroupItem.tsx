import { AccordionItem, Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import {
  Archive,
  CheckCircle2,
  CircleDot,
  Hand,
  Loader,
  type LucideIcon,
  PauseCircle,
  Star,
  XCircle,
} from 'lucide-react';
import { memo } from 'react';

import TopicItem from '../../List/Item';
import { type GroupItemComponentProps } from '../GroupedAccordion';

// Map each status-group id to its icon + color, mirroring the per-topic status
// glyphs in `List/Item`. `favorite` is the synthetic group split out by
// `buildGroupedTopics`, so it gets a star.
const STATUS_ICON: Record<string, { color: string; icon: LucideIcon }> = {
  active: { color: cssVar.colorTextTertiary, icon: CircleDot },
  archived: { color: cssVar.colorTextDescription, icon: Archive },
  completed: { color: cssVar.colorTextDescription, icon: CheckCircle2 },
  failed: { color: cssVar.colorError, icon: XCircle },
  favorite: { color: cssVar.colorWarning, icon: Star },
  paused: { color: cssVar.colorTextDescription, icon: PauseCircle },
  running: { color: cssVar.colorWarning, icon: Loader },
  waitingForHuman: { color: cssVar.colorInfo, icon: Hand },
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
