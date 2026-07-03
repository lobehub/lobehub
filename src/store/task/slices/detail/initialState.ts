import type { TaskDetailData } from '@lobechat/types';

import { type SaveStatus } from '@/types/saveState';

export interface TaskDetailSliceState {
  activeTaskId?: string;
  activeTopicDrawerTopicId?: string;
  isCreatingTask: boolean;
  isDeletingTask: boolean;
  taskDetailMap: Record<string, TaskDetailData>;
  taskSaveStatus: SaveStatus;
}

export const initialTaskDetailSliceState: TaskDetailSliceState = {
  isCreatingTask: false,
  isDeletingTask: false,
  taskDetailMap: {},
  taskSaveStatus: 'idle',
};
