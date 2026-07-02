import type { TaskDetailData, TaskVerifyConfig } from '@lobechat/types';

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

const activeTaskVisibility = (s: TaskStoreState): 'private' | 'public' =>
  activeTaskDetail(s)?.visibility ?? 'public';

const activeTaskInstruction = (s: TaskStoreState) => activeTaskDetail(s)?.instruction;

const activeTaskEditorData = (s: TaskStoreState) => activeTaskDetail(s)?.editorData;

const activeTaskFiles = (s: TaskStoreState) => activeTaskDetail(s)?.files;

const activeTaskDescription = (s: TaskStoreState) => activeTaskDetail(s)?.description;

const activeTaskAgentId = (s: TaskStoreState) => activeTaskDetail(s)?.agentId;

// TODO: Once the frontend store switches to reading from detail.model / detail.provider returned by the backend getTaskDetail procedure
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

// Read the RESOLVED verify config that getTaskDetail populates via
// TaskModel.getVerifyConfig (which includes the legacy `config.review` fallback
// during migration) — not the raw `config.verify`. Reading raw config.verify
// would return undefined for a legacy review-only task, so the panel would open
// as unconfigured and the first autosave could clobber the old settings.
const activeTaskVerifyConfig = (s: TaskStoreState): TaskVerifyConfig | undefined =>
  activeTaskDetail(s)?.verify ?? undefined;

const activeTaskWorkspace = (s: TaskStoreState) => activeTaskDetail(s)?.workspace ?? [];

const activeTaskWorkspaceId = (s: TaskStoreState) => activeTaskDetail(s)?.workspaceId;

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

export const taskDetailSelectors = {
  activeTaskAgentId,
  activeTaskAutomationMode,
  activeTaskCheckpoint,
  activeTaskModel,
  activeTaskDependencies,
  activeTaskDescription,
  activeTaskDetail,
  activeTaskEditorData,
  activeTaskError,
  activeTaskFiles,
  activeTaskId,
  activeTaskInstruction,
  activeTaskName,
  activeTaskParent,
  activeTaskPeriodicInterval,
  activeTaskPriority,
  activeTaskProvider,
  activeTaskScheduleMaxExecutions,
  activeTaskSchedulePattern,
  activeTaskScheduleTimezone,
  activeTaskStatus,
  activeTaskSubtasks,
  activeTaskTopicCount,
  activeTaskVerifyConfig,
  activeTaskVisibility,
  activeTaskWorkspace,
  activeTaskWorkspaceId,
  activeTopicDrawerTopicId,
  canCancelActiveTask,
  canPauseActiveTask,
  canRunActiveTask,
  isTaskDetailLoading,
  taskDetailById,
  taskSaveStatus,
};
