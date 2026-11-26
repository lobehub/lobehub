import { AccordionRoot, cssVar, Flexbox, Icon } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { LaptopIcon } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type ExecutionStatusVisual,
  TOPIC_GROUP_VISUALS,
  TOPIC_STATUS_VISUALS,
} from '@/components/ExecutionStatus';
import { projectDirectoryDeviceName } from '@/features/ChatInput/ControlBar/projectDeviceTargets';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';
import { type ProjectTopicSubGroupMode } from '@/store/global/initialState';
import { type ProjectDirectory, useProjectDirectories } from '@/store/projectWorkingDirectory';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';
import { type ChatTopic, type GroupedTopic } from '@/types/topic';

import { formatTimeGroupId } from '../ByTimeMode/timeGroupTitle';
import TopicSubGroupItem, { renderSubGroupTopic, useSubGroupExpansion } from '../TopicSubGroupItem';
import { deviceCategoryKey, deviceDisplayName } from './deviceIdentity';
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

interface ProjectTopicListProps {
  /** The group's effective sub-group mode (a folder gets `byDevice` only across machines). */
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
  const { t: tChat } = useTranslation('chat');
  const topicSortBy = useUserStore(preferenceSelectors.topicSortBy);
  const field = topicSortBy === 'createdAt' ? 'createdAt' : 'updatedAt';

  useDeviceStore((s) => s.useFetchDevices)(mode === 'byDevice');
  const devices = useDeviceStore(deviceSelectors.deviceList);
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
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
      return deviceDisplayName(deviceId, devices);
    },
    [mode, t, directories, devices],
  );

  // Device sections sharing a name — one machine under its personal and its
  // workspace identity — are told apart by their execution-environment category.
  const getTag = (group: GroupedTopic, title: string, titles: string[]) => {
    if (mode !== 'byDevice' || !group.id.startsWith(DEVICE_SUB_GROUP_PREFIX)) return;
    if (titles.filter((item) => item === title).length < 2) return;
    const key = deviceCategoryKey(
      group.id.slice(DEVICE_SUB_GROUP_PREFIX.length),
      devices,
      currentDeviceId,
    );
    return key && tChat(key);
  };

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

  const { expandedIds, onExpandedChange } = useSubGroupExpansion(groups);

  if (!groups) {
    return (
      <Flexbox gap={1} paddingBlock={1}>
        {topics.map((topic) => renderSubGroupTopic(topic, suppressAgentAvatar))}
      </Flexbox>
    );
  }

  const titles = groups.map(getTitle);

  return (
    <AccordionRoot
      indicatorPlacement="inline"
      style={{ gap: 1, paddingBlock: 1 }}
      value={expandedIds}
      onValueChange={onExpandedChange}
    >
      {groups.map((group, index) => (
        <TopicSubGroupItem
          expanded={!!expandedIds?.includes(group.id)}
          group={group}
          key={group.id}
          startDirectoryId={getStartDirectoryId(group)}
          suppressAgentAvatar={suppressAgentAvatar}
          tag={getTag(group, titles[index], titles)}
          title={titles[index]}
          icon={
            mode === 'byStatus' ? (
              STATUS_ICON[group.id] && (
                <Icon
                  color={STATUS_ICON[group.id].color}
                  icon={STATUS_ICON[group.id].icon}
                  size={{ size: 12 }}
                />
              )
            ) : mode === 'byDevice' ? (
              <Icon color={cssVar.colorTextTertiary} icon={LaptopIcon} size={{ size: 12 }} />
            ) : undefined
          }
          onStartInDirectory={onStartInDirectory}
        />
      ))}
    </AccordionRoot>
  );
}, isEqual);

ProjectTopicList.displayName = 'ProjectTopicList';

export default ProjectTopicList;
