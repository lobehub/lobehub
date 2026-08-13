import type { TaskDetailActivity, TaskDetailData, TaskVerifyConfig } from '@lobechat/types';

import type { TaskGroupListView } from './selectors';
import type { TaskListProjectionState } from './viewHooks';

const EMPTY_ACTIVITIES: TaskDetailActivity[] = [];
const EMPTY_GROUPS: TaskGroupListView = [];

const activeTaskDetail = (detail: TaskDetailData | undefined) => detail;
const activeTaskDatabaseId = (detail: TaskDetailData | undefined) => detail?.id;
const activeTaskName = (detail: TaskDetailData | undefined) => detail?.name;
const activeTaskStatus = (detail: TaskDetailData | undefined) => detail?.status;
const activeTaskPriority = (detail: TaskDetailData | undefined) => detail?.priority ?? 0;
const activeTaskVisibility = (detail: TaskDetailData | undefined): 'private' | 'public' =>
  detail?.visibility ?? 'public';
const activeTaskCreatedByUserId = (detail: TaskDetailData | undefined) => detail?.createdByUserId;
const activeTaskInstruction = (detail: TaskDetailData | undefined) => detail?.instruction;
const activeTaskEditorData = (detail: TaskDetailData | undefined) => detail?.editorData;
const activeTaskFiles = (detail: TaskDetailData | undefined) => detail?.files;
const activeTaskDescription = (detail: TaskDetailData | undefined) => detail?.description;
const activeTaskAgentId = (detail: TaskDetailData | undefined) => detail?.agentId;
const activeTaskModel = (detail: TaskDetailData | undefined) =>
  detail?.config?.model as string | undefined;
const activeTaskProvider = (detail: TaskDetailData | undefined) =>
  detail?.config?.provider as string | undefined;
const activeTaskSubtasks = (detail: TaskDetailData | undefined) => detail?.subtasks ?? [];
const activeTaskDependencies = (detail: TaskDetailData | undefined) => detail?.dependencies ?? [];
const activeTaskParent = (detail: TaskDetailData | undefined) => detail?.parent;
const activeTaskPeriodicInterval = (detail: TaskDetailData | undefined) =>
  detail?.heartbeat?.interval ?? 0;
const activeTaskAutomationMode = (detail: TaskDetailData | undefined) =>
  detail?.automationMode ?? null;
const activeTaskSchedulePattern = (detail: TaskDetailData | undefined) =>
  detail?.schedule?.pattern ?? null;
const activeTaskScheduleTimezone = (detail: TaskDetailData | undefined) =>
  detail?.schedule?.timezone ?? null;
const activeTaskScheduleMaxExecutions = (detail: TaskDetailData | undefined) =>
  detail?.schedule?.maxExecutions ?? null;
const activeTaskCheckpoint = (detail: TaskDetailData | undefined) => detail?.checkpoint;
const activeTaskVerifyConfig = (detail: TaskDetailData | undefined): TaskVerifyConfig | undefined =>
  detail?.verify ?? undefined;
const activeTaskWorkspace = (detail: TaskDetailData | undefined) => detail?.workspace ?? [];
const activeTaskWorkspaceId = (detail: TaskDetailData | undefined) => detail?.workspaceId;
const activeTaskError = (detail: TaskDetailData | undefined) => detail?.error;
const activeTaskTopicCount = (detail: TaskDetailData | undefined) => detail?.topicCount ?? 0;
const canRunActiveTask = (detail: TaskDetailData | undefined): boolean =>
  Boolean(detail && ['backlog', 'failed', 'paused', 'completed'].includes(detail.status));
const canPauseActiveTask = (detail: TaskDetailData | undefined): boolean =>
  detail?.status === 'running';
const canCancelActiveTask = (detail: TaskDetailData | undefined): boolean =>
  Boolean(detail && ['backlog', 'paused', 'running', 'scheduled'].includes(detail.status));
const isTaskDetailLoading = (detail: TaskDetailData | undefined): boolean => !detail;

export const taskDetailProjectionSelectors = {
  activeTaskAgentId,
  activeTaskAutomationMode,
  activeTaskCheckpoint,
  activeTaskCreatedByUserId,
  activeTaskDatabaseId,
  activeTaskDependencies,
  activeTaskDescription,
  activeTaskDetail,
  activeTaskEditorData,
  activeTaskError,
  activeTaskFiles,
  activeTaskInstruction,
  activeTaskModel,
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
  canCancelActiveTask,
  canPauseActiveTask,
  canRunActiveTask,
  isTaskDetailLoading,
};

const activeTaskActivities = (detail: TaskDetailData | undefined): TaskDetailActivity[] => {
  if (!detail?.activities) return EMPTY_ACTIVITIES;
  return [...detail.activities].sort((a, b) => {
    const timeA = a.time ? new Date(a.time).getTime() : 0;
    const timeB = b.time ? new Date(b.time).getTime() : 0;
    return timeA - timeB;
  });
};
const activeTaskBriefs = (detail: TaskDetailData | undefined) =>
  activeTaskActivities(detail).filter((activity) => activity.type === 'brief');
const activeTaskTopics = (detail: TaskDetailData | undefined) =>
  activeTaskActivities(detail).filter((activity) => activity.type === 'topic');
const activeTaskComments = (detail: TaskDetailData | undefined) =>
  activeTaskActivities(detail).filter((activity) => activity.type === 'comment');
const unresolvedBriefCount = (detail: TaskDetailData | undefined) =>
  activeTaskBriefs(detail).filter((brief) => !brief.resolvedAction).length;
const hasUnresolvedBriefs = (detail: TaskDetailData | undefined) =>
  unresolvedBriefCount(detail) > 0;
const activeDrawerTopicActivity =
  (topicId: string | undefined) =>
  (detail: TaskDetailData | undefined): TaskDetailActivity | undefined =>
    topicId ? activeTaskTopics(detail).find((activity) => activity.id === topicId) : undefined;

export const taskActivityProjectionSelectors = {
  activeDrawerTopicActivity,
  activeTaskActivities,
  activeTaskBriefs,
  activeTaskComments,
  activeTaskTopics,
  hasUnresolvedBriefs,
  unresolvedBriefCount,
};

const taskList = (view: TaskListProjectionState | undefined) => view?.items ?? [];
const taskListTotal = (view: TaskListProjectionState | undefined) => view?.total ?? 0;
const isTaskListInit = (view: TaskListProjectionState | undefined) => view !== undefined;
const isListEmpty = (view: TaskListProjectionState | undefined) =>
  view !== undefined && view.items.length === 0;
const taskGroups = (view: TaskGroupListView | undefined) => view ?? EMPTY_GROUPS;
const isTaskGroupListInit = (view: TaskGroupListView | undefined) => view !== undefined;
const taskGroupByKey = (key: string) => (view: TaskGroupListView | undefined) =>
  view?.find((group) => group.key === key);

const statusDisplayMap: Record<string, string> = {
  backlog: 'Backlog',
  canceled: 'Canceled',
  completed: 'Done',
  failed: 'Needs input',
  paused: 'Needs input',
  running: 'In progress',
  scheduled: 'Scheduled',
};

export const taskListProjectionSelectors = {
  getDisplayStatus: (status: string): string => statusDisplayMap[status] ?? status,
  isListEmpty,
  isTaskGroupListInit,
  isTaskListInit,
  taskGroupByKey,
  taskGroups,
  taskList,
  taskListTotal,
};
