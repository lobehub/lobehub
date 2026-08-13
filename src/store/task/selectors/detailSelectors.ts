import type { SaveStatus } from '@/types/saveState';

import type { TaskStoreState } from '../initialState';

const activeTaskId = (s: TaskStoreState) => s.activeTaskId;

const activeTaskInstructionRevision = (s: TaskStoreState) =>
  (s.activeTaskId ? s.taskInstructionRevisionMap[s.activeTaskId] : undefined) ?? 0;

// Save status is keyed per task, so switching tasks reads the target task's own
// status (defaulting to 'idle') instead of a stale 'failed' from a prior task.
const taskSaveStatus = (s: TaskStoreState): SaveStatus =>
  (s.activeTaskId ? s.taskSaveStatusMap[s.activeTaskId] : undefined) ?? 'idle';

const activeTopicDrawerTopicId = (s: TaskStoreState) => s.activeTopicDrawerTopicId;

const topicDrawerTitle = (s: TaskStoreState) => s.activeTopicDrawerTitle;

export const taskDetailSelectors = {
  activeTaskId,
  activeTaskInstructionRevision,
  activeTopicDrawerTopicId,
  taskSaveStatus,
  topicDrawerTitle,
};
