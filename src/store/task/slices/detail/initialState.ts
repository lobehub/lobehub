import type { TaskDetailData } from '@lobechat/types';

import { type SaveStatus } from '@/types/saveState';

export interface TaskDetailSliceState {
  activeTaskId?: string;
  /**
   * Topic-scoped fallbacks for a drawer opened outside a task detail — the home
   * inbox opens runs that may have no parent task at all, so there is no
   * `taskDetailMap` entry to read the agent / title from.
   */
  activeTopicDrawerAgentId?: string;
  activeTopicDrawerTitle?: string;
  activeTopicDrawerTopicId?: string;
  isCreatingTask: boolean;
  isDeletingTask: boolean;
  taskDetailMap: Record<string, TaskDetailData>;
  // Save status is scoped per task id (mirrors `taskDetailMap`). A store-wide
  // field would leak one task's `failed` state across navigation, since
  // `setActiveTaskId` only swaps `activeTaskId` and never clears the status.
  taskSaveStatusMap: Record<string, SaveStatus>;
}

export const initialTaskDetailSliceState: TaskDetailSliceState = {
  isCreatingTask: false,
  isDeletingTask: false,
  taskDetailMap: {},
  taskSaveStatusMap: {},
};
