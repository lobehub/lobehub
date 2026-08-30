import type { SaveStatus } from '@/types/saveState';

import type { TaskStoreState } from '../initialState';

const activeTaskId = (s: TaskStoreState) => s.activeTaskId;

const activeTaskInstructionRevision = (s: TaskStoreState) =>
  (s.activeTaskId ? s.taskInstructionRevisionMap[s.activeTaskId] : undefined) ?? 0;

const taskSaveStatus = (s: TaskStoreState): SaveStatus =>
  (s.activeTaskId ? s.taskSaveStatusMap[s.activeTaskId] : undefined) ?? 'idle';

const activeTopicDrawerTopicId = (s: TaskStoreState) => s.activeTopicDrawerTopicId;

const topicDrawerAgentId = (s: TaskStoreState) => s.activeTopicDrawerAgentId;

const topicDrawerTitle = (s: TaskStoreState) => s.activeTopicDrawerTitle;

export const taskDetailSelectors = {
  activeTaskId,
  activeTaskInstructionRevision,
  activeTopicDrawerTopicId,
  taskSaveStatus,
  topicDrawerAgentId,
  topicDrawerTitle,
};
