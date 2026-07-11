import type { TaskDetailData } from '@lobechat/types';

import { type SaveStatus } from '@/types/saveState';

export interface TaskDetailSliceState {
  activeTaskId?: string;
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
