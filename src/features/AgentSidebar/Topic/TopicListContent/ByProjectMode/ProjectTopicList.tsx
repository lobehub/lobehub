import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionRoot,
  accordionStyles,
  AccordionTrigger,
  ActionIcon,
  Center,
  cssVar,
  cx,
  Flexbox,
  Icon,
  Text,
} from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { LaptopIcon, PlusIcon } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type ExecutionStatusVisual,
  TOPIC_GROUP_VISUALS,
  TOPIC_STATUS_VISUALS,
} from '@/components/ExecutionStatus';
import { projectDirectoryDeviceName } from '@/features/ChatInput/ControlBar/projectDeviceTargets';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import { type ProjectTopicSubGroupMode } from '@/store/global/initialState';
import { type ProjectDirectory, useProjectDirectories } from '@/store/projectWorkingDirectory';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';
import { type ChatTopic, type GroupedTopic } from '@/types/topic';

import TopicItem from '../../List/Item';
import { formatTimeGroupId } from '../ByTimeMode/timeGroupTitle';
import {
  DEVICE_SUB_GROUP_PREFIX,
  groupProjectTopics,
  UNKNOWN_DEVICE_SUB_GROUP_ID,
} from './subGroups';

const STATUS_ICON: Record<string, ExecutionStatusVisual> = {
  ...TOPIC_STATUS_VISUALS,
  ...TOPIC_GROUP_VISUALS,
};

const renderTopic = (topic: ChatTopic) => (
  <TopicItem
    fav={topic.favorite}
    id={topic.id}
    key={topic.id}
    metadata={topic.metadata}
    runStartedAt={topic.runStartedAt}
    status={topic.status}
    title={topic.title}
    userId={topic.userId}
  />
);

interface ProjectTopicListProps {
  /** The group's effective sub-group mode (folders never get `byDevice`). */
  mode: ProjectTopicSubGroupMode;
  /** Opens the new-topic composer staged on one project directory. */
  onStartInDirectory?: (projectWorkingDirectoryId: string) => void;
  /** The group's project directories a device section's "+" may start in. */
  startDirectories?: ProjectDirectory[];
  topics: ChatTopic[];
}

/**
 * Topics of one byProject sidebar group, optionally sectioned by device, time
 * or status (picked from the group's "more" menu).
 */
const ProjectTopicList = memo<ProjectTopicListProps>((props) => {
  const { mode, onStartInDirectory, startDirectories, topics } = props;
  const { t } = useTranslation('topic');
  const { t: tProject } = useTranslation('project');
  const topicSortBy = useUserStore(preferenceSelectors.topicSortBy);
  const field = topicSortBy === 'createdAt' ? 'createdAt' : 'updatedAt';

  useDeviceStore((s) => s.useFetchDevices)(mode === 'byDevice');
  const devices = useDeviceStore(deviceSelectors.deviceList);
  const directories = useProjectDirectories();

  // A joined id string, not the Set itself: the selector must return something
  // comparable or every operation write would re-render the list.
  const runningIdsKey = useChatStore((s) => {
    if (mode !== 'byStatus') return '';
    const running = operationSelectors.visiblyRunningTopicIds(s);
    return topics
      .filter((topic) => running.has(topic.id))
      .map((topic) => topic.id)
      .join(',');
  });

  const resolveDeviceId = useCallback(
    (topic: ChatTopic) =>
      (topic.projectWorkingDirectoryId &&
        directories.find((directory) => directory.id === topic.projectWorkingDirectoryId)
          ?.deviceId) ||
      topic.metadata?.boundDeviceId,
    [directories],
  );

  const groups = useMemo(
    () =>
      groupProjectTopics(topics, mode, {
        field,
        loadingTopicIds: runningIdsKey ? new Set(runningIdsKey.split(',')) : undefined,
        resolveDeviceId,
      }),
    [topics, mode, field, runningIdsKey, resolveDeviceId],
  );

  const getTitle = useCallback(
    (group: GroupedTopic) => {
      if (mode === 'byStatus') return t(`groupTitle.byStatus.${group.id}` as any);
      if (mode === 'byTime')
        return formatTimeGroupId(group.id) ?? t(`groupTitle.byTime.${group.id}` as any);
      if (group.id === UNKNOWN_DEVICE_SUB_GROUP_ID) return t('groupTitle.byDevice.unknown');

      const deviceId = group.id.slice(DEVICE_SUB_GROUP_PREFIX.length);
      const directory = directories.find((item) => item.deviceId === deviceId);
      if (directory) return projectDirectoryDeviceName(directory, devices);
      const device = devices.find((item) => item.deviceId === deviceId);
      return device?.friendlyName || device?.hostname || deviceId;
    },
    [mode, t, directories, devices],
  );

  // The directory a device section's "+" starts in: the one its newest topic
  // runs in, else any of the group's directories on that device.
  const getStartDirectoryId = (group: GroupedTopic) => {
    if (mode !== 'byDevice' || !onStartInDirectory || !startDirectories?.length) return;
    if (!group.id.startsWith(DEVICE_SUB_GROUP_PREFIX)) return;
    const deviceId = group.id.slice(DEVICE_SUB_GROUP_PREFIX.length);
    const candidates = startDirectories.filter((item) => item.deviceId === deviceId);
    const used = group.children.find((topic) =>
      candidates.some((item) => item.id === topic.projectWorkingDirectoryId),
    )?.projectWorkingDirectoryId;
    return used ?? candidates[0]?.id;
  };

  // Sections start expanded; only the ones the user folds are remembered.
  const [collapsedIds, setCollapsedIds] = useState<string[]>([]);
  const expandedIds = useMemo(
    () => groups?.filter((group) => !collapsedIds.includes(group.id)).map((group) => group.id),
    [groups, collapsedIds],
  );
  const handleExpandedChange = useCallback(
    (next: unknown[]) =>
      setCollapsedIds((prev) => [
        ...prev.filter((id) => !groups?.some((group) => group.id === id)),
        ...(groups ?? []).filter((group) => !next.includes(group.id)).map((group) => group.id),
      ]),
    [groups],
  );

  if (!groups) {
    return (
      <Flexbox gap={1} paddingBlock={1}>
        {topics.map(renderTopic)}
      </Flexbox>
    );
  }

  return (
    <AccordionRoot
      indicatorPlacement="inline"
      style={{ gap: 1, paddingBlock: 1 }}
      value={expandedIds}
      onValueChange={handleExpandedChange}
    >
      {groups.map((group) => {
        const icon =
          mode === 'byStatus'
            ? STATUS_ICON[group.id]
            : mode === 'byDevice'
              ? { color: cssVar.colorTextTertiary, icon: LaptopIcon }
              : undefined;
        const startDirectoryId = getStartDirectoryId(group);
        return (
          <AccordionItem key={group.id} value={group.id}>
            <AccordionHeader className={'accordion-header'}>
              {/* Same icon column and gap as the project row, so the section
                  title lines up with the project name and the topics below. */}
              <AccordionTrigger style={{ paddingBlock: 2, paddingInline: 4 }}>
                <Flexbox
                  horizontal
                  align="center"
                  gap={8}
                  height={24}
                  style={{ overflow: 'hidden' }}
                >
                  <Center flex={'none'} height={24} width={28}>
                    {icon && <Icon color={icon.color} icon={icon.icon} size={{ size: 12 }} />}
                  </Center>
                  <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
                    {getTitle(group)}
                  </Text>
                </Flexbox>
              </AccordionTrigger>
              {startDirectoryId && (
                <div
                  className={cx(
                    'accordion-action',
                    accordionStyles.action,
                    accordionStyles.actionBorderless,
                  )}
                >
                  <ActionIcon
                    icon={PlusIcon}
                    size={'small'}
                    title={tProject('directories.start')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onStartInDirectory?.(startDirectoryId);
                    }}
                  />
                </div>
              )}
            </AccordionHeader>
            <AccordionPanel contentStyle={{ padding: 0 }}>
              <Flexbox gap={1} paddingBlock={1}>
                {group.children.map(renderTopic)}
              </Flexbox>
            </AccordionPanel>
          </AccordionItem>
        );
      })}
    </AccordionRoot>
  );
}, isEqual);

ProjectTopicList.displayName = 'ProjectTopicList';

export default ProjectTopicList;
