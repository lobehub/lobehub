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
import EmptyNavItem from '@/features/NavPanel/components/EmptyNavItem';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
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
import { indicatorStyles, useCollapsedIndicators } from './CollapsedIndicators';
import {
  DEVICE_SUB_GROUP_PREFIX,
  groupProjectTopics,
  UNKNOWN_DEVICE_SUB_GROUP_ID,
} from './subGroups';

const STATUS_ICON: Record<string, ExecutionStatusVisual> = {
  ...TOPIC_STATUS_VISUALS,
  ...TOPIC_GROUP_VISUALS,
};

/**
 * A device section only offers a start where the run can actually begin: the
 * server refuses a directory without an enabled environment binding, a
 * read-only one, and — for an agent with a fixed execution target — any device
 * but its bound one. A fixed non-device target (sandbox, local) binds no
 * device, so it starts on none.
 */
const isStartableDirectory = (
  directory: ProjectDirectory,
  fixed: { boundDeviceId?: string } | undefined,
) => !!directory.runnable && (!fixed || directory.deviceId === fixed.boundDeviceId);

/** Project topic rows carry their agent's execution-target pin. */
interface AgentPinnedRow {
  agentBoundDeviceId?: string | null;
  agentExecutionTargetSelectionPolicy?: string | null;
  agentId?: string | null;
}

const renderTopic = (topic: ChatTopic, suppressAgentAvatar?: boolean) => (
  <TopicItem
    fav={topic.favorite}
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

interface SubGroupItemProps {
  expanded: boolean;
  group: GroupedTopic;
  icon?: Pick<ExecutionStatusVisual, 'color' | 'icon'>;
  onStartInDirectory?: (projectWorkingDirectoryId: string) => void;
  startDirectoryId?: string;
  suppressAgentAvatar?: boolean;
  title: string;
}

const SubGroupItem = memo<SubGroupItemProps>(
  ({ expanded, group, icon, onStartInDirectory, startDirectoryId, suppressAgentAvatar, title }) => {
    const { t } = useTranslation('topic');
    const { t: tProject } = useTranslation('project');
    // A folded section keeps the project row's running / awaiting / failed
    // counts and unread dot, so a device section still says how much it does.
    const { hasIndicators, indicators } = useCollapsedIndicators(group.children, expanded);

    return (
      <AccordionItem value={group.id}>
        <AccordionHeader className={'accordion-header'}>
          {/* Same icon column and gap as the project row, so the section
              title lines up with the project name and the topics below. */}
          <AccordionTrigger style={{ paddingBlock: 2, paddingInline: 4 }}>
            <Flexbox horizontal align="center" gap={8} height={24} style={{ overflow: 'hidden' }}>
              <Center flex={'none'} height={24} width={28}>
                {icon && <Icon color={icon.color} icon={icon.icon} size={{ size: 12 }} />}
              </Center>
              <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
                {title}
              </Text>
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
              // A device listed before any topic ran on it starts one in place.
              <EmptyNavItem
                title={t('actions.addNewTopic')}
                onClick={() => onStartInDirectory?.(startDirectoryId)}
              />
            ) : (
              group.children.map((topic) => renderTopic(topic, suppressAgentAvatar))
            )}
          </Flexbox>
        </AccordionPanel>
      </AccordionItem>
    );
  },
  isEqual,
);

SubGroupItem.displayName = 'ProjectTopicSubGroupItem';

interface ProjectTopicListProps {
  /** The group's effective sub-group mode (folders never get `byDevice`). */
  mode: ProjectTopicSubGroupMode;
  /** Opens the new-topic composer staged on one project directory. */
  onStartInDirectory?: (projectWorkingDirectoryId: string) => void;
  /** The agent a device section's "+" starts with; fixed to one device, it starts only there. */
  startAgentId?: string;
  /** The group's project directories a device section's "+" may start in. */
  startDirectories?: ProjectDirectory[];
  /** Set when the parent group header already names the owning agent. */
  suppressAgentAvatar?: boolean;
  topics: ChatTopic[];
}

/**
 * Topics of one byProject sidebar group, optionally sectioned by device, time
 * or status (picked from the group's "more" menu).
 */
const ProjectTopicList = memo<ProjectTopicListProps>((props) => {
  const { mode, onStartInDirectory, suppressAgentAvatar, topics } = props;
  const { t } = useTranslation('topic');
  const topicSortBy = useUserStore(preferenceSelectors.topicSortBy);
  const field = topicSortBy === 'createdAt' ? 'createdAt' : 'updatedAt';

  useDeviceStore((s) => s.useFetchDevices)(mode === 'byDevice');
  const devices = useDeviceStore(deviceSelectors.deviceList);
  const directories = useProjectDirectories();
  // The shared row, not a topic-pinned config: a fixed target is the author's
  // setting, and it is what the server checks a start against.
  const { startAgentId } = props;
  const agencyConfig = useAgentStore((s) =>
    startAgentId ? agentByIdSelectors.getAgencyConfigById(startAgentId)(s) : undefined,
  );
  // Only agents the client has opened are in the agent store; every other
  // agent's pin comes with its project topic rows.
  const pinRow = startAgentId
    ? (topics as AgentPinnedRow[]).find(
        (topic) => topic.agentId === startAgentId && topic.agentExecutionTargetSelectionPolicy,
      )
    : undefined;
  const isFixed =
    (agencyConfig?.executionTargetSelectionPolicy ??
      pinRow?.agentExecutionTargetSelectionPolicy) === 'fixed';
  const boundDeviceId = agencyConfig
    ? agencyConfig.boundDeviceId
    : (pinRow?.agentBoundDeviceId ?? undefined);
  const startDirectories = useMemo(
    () =>
      props.startDirectories?.filter((item) =>
        isStartableDirectory(item, isFixed ? { boundDeviceId } : undefined),
      ),
    [props.startDirectories, isFixed, boundDeviceId],
  );

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

  // Every device the group can start a topic on gets a section, topics or not.
  const availableDeviceIds = useMemo(() => {
    if (mode !== 'byDevice' || !onStartInDirectory || !startDirectories?.length) return;
    return [
      ...new Set(startDirectories.map((item) => item.deviceId).filter((id): id is string => !!id)),
    ];
  }, [mode, onStartInDirectory, startDirectories]);

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
        availableDeviceIds,
        field,
        loadingTopicIds: runningIdsKey ? new Set(runningIdsKey.split(',')) : undefined,
        resolveDeviceId,
      }),
    [topics, mode, availableDeviceIds, field, runningIdsKey, resolveDeviceId],
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
        {topics.map((topic) => renderTopic(topic, suppressAgentAvatar))}
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
      {groups.map((group) => (
        <SubGroupItem
          expanded={!!expandedIds?.includes(group.id)}
          group={group}
          key={group.id}
          startDirectoryId={getStartDirectoryId(group)}
          suppressAgentAvatar={suppressAgentAvatar}
          title={getTitle(group)}
          icon={
            mode === 'byStatus'
              ? STATUS_ICON[group.id]
              : mode === 'byDevice'
                ? { color: cssVar.colorTextTertiary, icon: LaptopIcon }
                : undefined
          }
          onStartInDirectory={onStartInDirectory}
        />
      ))}
    </AccordionRoot>
  );
}, isEqual);

ProjectTopicList.displayName = 'ProjectTopicList';

export default ProjectTopicList;
