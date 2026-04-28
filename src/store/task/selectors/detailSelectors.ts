import type { TaskDetailData } from '@lobechat/types';

import type { TaskStoreState } from '../initialState';

const activeTaskId = (s: TaskStoreState) => s.activeTaskId;

const activeTaskDetail = (s: TaskStoreState): TaskDetailData | undefined =>
  s.activeTaskId ? s.taskDetailMap[s.activeTaskId] : undefined;

const taskDetailById = (id: string) => (s: TaskStoreState) => s.taskDetailMap[id];

const isTaskDetailLoading = (s: TaskStoreState): boolean =>
  !s.activeTaskId || !s.taskDetailMap[s.activeTaskId];

const activeTaskName = (s: TaskStoreState) => activeTaskDetail(s)?.name;

const activeTaskStatus = (s: TaskStoreState) => activeTaskDetail(s)?.status;

const activeTaskPriority = (s: TaskStoreState) => activeTaskDetail(s)?.priority ?? 0;

const activeTaskInstruction = (s: TaskStoreState) => activeTaskDetail(s)?.instruction;

const activeTaskDescription = (s: TaskStoreState) => activeTaskDetail(s)?.description;

const activeTaskAgentId = (s: TaskStoreState) => activeTaskDetail(s)?.agentId;

// TODO [LOBE-6634]: Once the backend getTaskDetail returns model/provider, read from detail.model / detail.provider instead
const activeTaskModel = (s: TaskStoreState) =>
  activeTaskDetail(s)?.config?.model as string | undefined;

const activeTaskProvider = (s: TaskStoreState) =>
  activeTaskDetail(s)?.config?.provider as string | undefined;

const activeTaskSubtasks = (s: TaskStoreState) => activeTaskDetail(s)?.subtasks ?? [];

const activeTaskDependencies = (s: TaskStoreState) => activeTaskDetail(s)?.dependencies ?? [];

const activeTaskParent = (s: TaskStoreState) => activeTaskDetail(s)?.parent;

// Periodic execution interval (seconds); 0 or undefined means not configured
const activeTaskPeriodicInterval = (s: TaskStoreState) =>
  activeTaskDetail(s)?.heartbeat?.interval ?? 0;

// Automation mode: 'heartbeat' | 'schedule' | null (null = no automation)
const activeTaskAutomationMode = (s: TaskStoreState) => activeTaskDetail(s)?.automationMode ?? null;

// Schedule (cron) mode fields. pattern/timezone are columns; maxExecutions lives in config.schedule.
const activeTaskSchedulePattern = (s: TaskStoreState) =>
  activeTaskDetail(s)?.schedule?.pattern ?? null;

const activeTaskScheduleTimezone = (s: TaskStoreState) =>
  activeTaskDetail(s)?.schedule?.timezone ?? null;

const activeTaskScheduleMaxExecutions = (s: TaskStoreState) =>
  activeTaskDetail(s)?.schedule?.maxExecutions ?? null;

const activeTaskCheckpoint = (s: TaskStoreState) => activeTaskDetail(s)?.checkpoint;

const activeTaskReview = (s: TaskStoreState) => activeTaskDetail(s)?.review;

const activeTaskWorkspace = (s: TaskStoreState) => activeTaskDetail(s)?.workspace ?? [];

const activeTaskError = (s: TaskStoreState) => activeTaskDetail(s)?.error;

const activeTaskTopicCount = (s: TaskStoreState) => activeTaskDetail(s)?.topicCount ?? 0;

const canRunActiveTask = (s: TaskStoreState): boolean => {
  const detail = activeTaskDetail(s);
  if (!detail) return false;
  // 'scheduled' is intentionally excluded — automation owns the next run; the
  // user can only cancel, not force an immediate run.
  return ['backlog', 'failed', 'paused', 'completed'].includes(detail.status);
};

const canPauseActiveTask = (s: TaskStoreState): boolean =>
  activeTaskDetail(s)?.status === 'running';

const canCancelActiveTask = (s: TaskStoreState): boolean => {
  const detail = activeTaskDetail(s);
  if (!detail) return false;
  return ['backlog', 'paused', 'running', 'scheduled'].includes(detail.status);
};

const taskSaveStatus = (s: TaskStoreState) => s.taskSaveStatus;

const activeTopicDrawerTopicId = (s: TaskStoreState) => s.activeTopicDrawerTopicId;

const activePageDrawerPageId = (s: TaskStoreState) => s.activePageDrawerPageId;

export const taskDetailSelectors = {
  activePageDrawerPageId,
  activeTaskAgentId,
  activeTaskAutomationMode,
  activeTaskCheckpoint,
  activeTaskModel,
  activeTaskDependencies,
  activeTaskDescription,
  activeTaskDetail,
  activeTaskError,
  activeTaskId,
  activeTaskInstruction,
  activeTaskName,
  activeTaskParent,
  activeTaskPeriodicInterval,
  activeTaskPriority,
  activeTaskProvider,
  activeTaskReview,
  activeTaskScheduleMaxExecutions,
  activeTaskSchedulePattern,
  activeTaskScheduleTimezone,
  activeTaskStatus,
  activeTaskSubtasks,
  activeTaskTopicCount,
  activeTaskWorkspace,
  activeTopicDrawerTopicId,
  canCancelActiveTask,
  canPauseActiveTask,
  canRunActiveTask,
  isTaskDetailLoading,
  taskDetailById,
  taskSaveStatus,
};
