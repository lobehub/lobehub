import type { TaskDetailData } from '@lobechat/types';

export interface TaskDetailSliceState {
  activeTaskId?: string;
  activeTopicDrawerTopicId?: string;
  isCreatingTask: boolean;
  isDeletingTask: boolean;
  taskDetailMap: Record<string, TaskDetailData>;
  taskSaveStatus: 'idle' | 'saved' | 'saving';
}

export const initialTaskDetailSliceState: TaskDetailSliceState = {
  isCreatingTask: false,
  isDeletingTask: false,
  taskDetailMap: {},
  taskSaveStatus: 'idle',
};
