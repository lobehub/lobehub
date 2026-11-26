import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  accordionStyles,
  AccordionTrigger,
  ActionIcon,
  Center,
  cssVar,
  cx,
  Flexbox,
  Tag,
  Text,
} from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { PlusIcon } from 'lucide-react';
import { memo, type ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import TailMarquee from '@/components/TailMarquee';
import EmptyNavItem from '@/features/NavPanel/components/EmptyNavItem';
import { useNavItemMetrics } from '@/features/NavPanel/density';
import { type ChatTopic, type GroupedTopic } from '@/types/topic';

import TopicItem from '../List/Item';
import { indicatorStyles, useCollapsedIndicators } from './ByProjectMode/CollapsedIndicators';

export const renderSubGroupTopic = (topic: ChatTopic, suppressAgentAvatar?: boolean) => (
  <TopicItem
    fav={topic.favorite}
    hasGoal={topic.hasGoal}
    id={topic.id}
    key={topic.id}
    metadata={topic.metadata}
    runStartedAt={topic.runStartedAt}
    status={topic.status}
    suppressAgentAvatar={suppressAgentAvatar}
    title={topic.title}
    userId={topic.userId}
  />
);

interface TopicSubGroupItemProps {
  expanded: boolean;
  group: GroupedTopic;
  /** Sits in the parent row's icon column, so the section title lines up with it. */
  icon?: ReactNode;
  onStartInDirectory?: (projectWorkingDirectoryId: string) => void;
  startDirectoryId?: string;
  suppressAgentAvatar?: boolean;
  /** Tells apart sections whose titles match, e.g. one machine's two device identities. */
  tag?: string;
  title: string;
}

/**
 * The second level of a sidebar topic group: a foldable section with its own
 * collapsed indicators and an optional "+" that starts a topic in one project
 * directory.
 */
const TopicSubGroupItem = memo<TopicSubGroupItemProps>(
  ({
    expanded,
    group,
    icon,
    onStartInDirectory,
    startDirectoryId,
    suppressAgentAvatar,
    tag,
    title,
  }) => {
    const metrics = useNavItemMetrics();
    const { t } = useTranslation('topic');
    const { t: tProject } = useTranslation('project');
    // A folded section keeps the parent row's running / awaiting / failed
    // counts and unread dot, so it still says how much it does.
    const { hasIndicators, indicators } = useCollapsedIndicators(group.children, expanded);

    return (
      <AccordionItem value={group.id}>
        <AccordionHeader className={'accordion-header'}>
          {/* Same icon column and gap as the parent row, so the section
              title lines up with the parent name and the topics below. */}
          <AccordionTrigger style={{ paddingBlock: 2, paddingInline: 4 }}>
            <Flexbox
              horizontal
              align="center"
              gap={metrics.gap}
              height={24}
              style={{ overflow: 'hidden' }}
            >
              <Center flex={'none'} height={24} width={metrics.iconBox}>
                {icon}
              </Center>
              <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
                {title}
              </Text>
              {tag && (
                <Tag
                  size={'small'}
                  style={{
                    color: cssVar.colorTextDescription,
                    flex: '0 1 auto',
                    fontSize: 10,
                    maxWidth: '50%',
                    minWidth: 0,
                    overflow: 'hidden',
                  }}
                >
                  <TailMarquee>{tag}</TailMarquee>
                </Tag>
              )}
            </Flexbox>
          </AccordionTrigger>
          {(startDirectoryId || hasIndicators) && (
            <div
              className={cx(
                'accordion-action',
                accordionStyles.action,
                accordionStyles.actionBorderless,
                hasIndicators && accordionStyles.actionAlwaysVisible,
              )}
            >
              <Flexbox horizontal align={'center'} gap={4}>
                {indicators}
                {startDirectoryId && (
                  <span className={indicatorStyles.hoverActions}>
                    <ActionIcon
                      icon={PlusIcon}
                      size={'small'}
                      title={tProject('directories.start')}
                      onClick={(e) => {
                        e.stopPropagation();
                        onStartInDirectory?.(startDirectoryId);
                      }}
                    />
                  </span>
                )}
              </Flexbox>
            </div>
          )}
        </AccordionHeader>
        <AccordionPanel contentStyle={{ padding: 0 }}>
          <Flexbox gap={1} paddingBlock={1}>
            {group.children.length === 0 && startDirectoryId ? (
              // A section listed before any topic ran in it starts one in place.
              <EmptyNavItem
                title={t('actions.addNewTopic')}
                onClick={() => onStartInDirectory?.(startDirectoryId)}
              />
            ) : (
              group.children.map((topic) => renderSubGroupTopic(topic, suppressAgentAvatar))
            )}
          </Flexbox>
        </AccordionPanel>
      </AccordionItem>
    );
  },
  isEqual,
);

TopicSubGroupItem.displayName = 'TopicSubGroupItem';

export default TopicSubGroupItem;

/** Sections start expanded; only the ones the user folds are remembered. */
export const useSubGroupExpansion = (groups: GroupedTopic[] | undefined) => {
  const [collapsedIds, setCollapsedIds] = useState<string[]>([]);
  const expandedIds = useMemo(
    () => groups?.filter((group) => !collapsedIds.includes(group.id)).map((group) => group.id),
    [groups, collapsedIds],
  );
  const onExpandedChange = useCallback(
    (next: unknown[]) =>
      setCollapsedIds((prev) => [
        ...prev.filter((id) => !groups?.some((group) => group.id === id)),
        ...(groups ?? []).filter((group) => !next.includes(group.id)).map((group) => group.id),
      ]),
    [groups],
  );
  return { expandedIds, onExpandedChange };
};
