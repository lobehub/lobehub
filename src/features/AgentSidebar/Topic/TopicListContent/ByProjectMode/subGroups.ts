import { type ProjectTopicSubGroupMode } from '@/store/global/initialState';
import { type ChatTopic, type GroupedTopic } from '@/types/topic';
import {
  groupTopicsByStatus,
  groupTopicsByTime,
  groupTopicsByUpdatedTime,
} from '@/utils/client/topic';

export const DEVICE_SUB_GROUP_PREFIX = 'device:';
export const UNKNOWN_DEVICE_SUB_GROUP_ID = 'device-unknown';

interface GroupProjectTopicsOptions {
  field: 'createdAt' | 'updatedAt';
  loadingTopicIds?: ReadonlySet<string>;
  /** The machine a topic runs on — its project directory's device, else its pinned device. */
  resolveDeviceId: (topic: ChatTopic) => string | undefined;
}

/**
 * Section the topics of one byProject sidebar group. Returns `undefined` for
 * `none`, so the caller keeps the plain list.
 *
 * Device sections keep the incoming (sidebar-sorted) topic order, so the machine
 * with the most recent topic comes first; topics whose machine can't be resolved
 * (path-only or conversation-only rows) trail in their own section.
 */
export const groupProjectTopics = (
  topics: ChatTopic[],
  mode: ProjectTopicSubGroupMode,
  { field, loadingTopicIds, resolveDeviceId }: GroupProjectTopicsOptions,
): GroupedTopic[] | undefined => {
  if (mode === 'byTime')
    return field === 'updatedAt' ? groupTopicsByUpdatedTime(topics) : groupTopicsByTime(topics);
  if (mode === 'byStatus') return groupTopicsByStatus(topics, field, loadingTopicIds);
  if (mode !== 'byDevice') return undefined;

  const groups = new Map<string, ChatTopic[]>();
  const unknown: ChatTopic[] = [];
  for (const topic of topics) {
    const deviceId = resolveDeviceId(topic);
    if (!deviceId) {
      unknown.push(topic);
      continue;
    }
    const id = `${DEVICE_SUB_GROUP_PREFIX}${deviceId}`;
    const existing = groups.get(id);
    if (existing) existing.push(topic);
    else groups.set(id, [topic]);
  }

  const result: GroupedTopic[] = Array.from(groups, ([id, children]) => ({ children, id }));
  if (unknown.length) result.push({ children: unknown, id: UNKNOWN_DEVICE_SUB_GROUP_ID });
  return result;
};
