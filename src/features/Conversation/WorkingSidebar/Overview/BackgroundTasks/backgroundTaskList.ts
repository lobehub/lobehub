import type {
  HeteroBackgroundTask,
  HeteroBackgroundTaskStatus,
} from '@lobechat/heterogeneous-agents';

/** Finished tasks shown before "show all". */
export const FINISHED_TASKS_PREVIEW = 5;

const STATUSES = new Set<HeteroBackgroundTaskStatus>([
  'completed',
  'failed',
  'interrupted',
  'running',
  'stopped',
]);

export interface BackgroundTaskItem {
  /** The tool message that started the task and carries its snapshot. */
  messageId: string;
  /**
   * What to show: a task stored as `running` whose run is gone (the app
   * restarted, the process died before it could say so) shows `interrupted`.
   */
  status: HeteroBackgroundTaskStatus;
  task: HeteroBackgroundTask;
  toolCallId: string;
}

interface ToolMessageLike {
  id: string;
  pluginState?: Record<string, any> | null;
  role?: string;
  tool_call_id?: string | null;
}

const readTask = (value: unknown): HeteroBackgroundTask | undefined => {
  const task = value as HeteroBackgroundTask | undefined;
  if (!task || typeof task.taskId !== 'string' || !STATUSES.has(task.status)) return;
  if (typeof task.startedAt !== 'number') return;
  return task;
};

/**
 * Every background task of the conversation, newest first.
 *
 * @param isRunLive Whether the run hosting a task (`task.operationId`) is
 *   still alive in this client.
 */
export const collectBackgroundTasks = (
  messages: readonly ToolMessageLike[],
  isRunLive: (operationId: string | undefined) => boolean,
): BackgroundTaskItem[] => {
  const items: BackgroundTaskItem[] = [];
  for (const message of messages) {
    if (message.role !== 'tool' || !message.tool_call_id) continue;
    const task = readTask(message.pluginState?.backgroundTask);
    if (!task) continue;

    const status =
      task.status === 'running' && !isRunLive(task.operationId) ? 'interrupted' : task.status;
    items.push({ messageId: message.id, status, task, toolCallId: message.tool_call_id });
  }

  const sortKey = (item: BackgroundTaskItem) => item.task.endedAt ?? item.task.startedAt;
  return items.sort((a, b) => sortKey(b) - sortKey(a));
};

export interface BackgroundTaskGroups {
  /** Finished tasks currently shown. */
  finished: BackgroundTaskItem[];
  /** Finished tasks folded away behind "show all". */
  hiddenCount: number;
  running: BackgroundTaskItem[];
}

/** Every running task, and the most recent finished ones unless all are asked for. */
export const groupBackgroundTasks = (
  items: readonly BackgroundTaskItem[],
  showAllFinished: boolean,
): BackgroundTaskGroups => {
  const running = items.filter((item) => item.status === 'running');
  const allFinished = items.filter((item) => item.status !== 'running');
  const finished = showAllFinished ? allFinished : allFinished.slice(0, FINISHED_TASKS_PREVIEW);
  return { finished, hiddenCount: allFinished.length - finished.length, running };
};

interface OperationLike {
  id: string;
  metadata?: { serverOperationId?: string };
  status: string;
}

const LIVE_OPERATION_STATUSES = new Set(['paused', 'running']);

/**
 * How to stop a running task.
 * - `local`: this window hosts the run and can stop one task (SDK session);
 * - `server`: the run lives on a server-reached `lh` (device, gateway, cloud);
 * - `undefined`: no way to stop just this task (a plain local CLI spawn).
 */
export type BackgroundTaskStopRoute = 'local' | 'server';

/** The store operation that hosts a run, matched by local or server id. */
export const findLiveOperation = <T extends OperationLike>(
  operations: readonly T[],
  operationId: string | undefined,
): T | undefined => {
  if (!operationId) return;
  return operations.find(
    (op) =>
      LIVE_OPERATION_STATUSES.has(op.status) &&
      (op.id === operationId || op.metadata?.serverOperationId === operationId),
  );
};

export const resolveStopRoute = (
  operations: readonly OperationLike[],
  operationId: string | undefined,
  hasLocalStopper: boolean,
): BackgroundTaskStopRoute | undefined => {
  if (hasLocalStopper) return 'local';
  const operation = findLiveOperation(operations, operationId);
  if (operation && operation.metadata?.serverOperationId === operationId) return 'server';
  return undefined;
};

/** The directory holding an output file: the root a file read is scoped to. */
export const outputDirectoryOf = (path: string): string => {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return index > 0 ? path.slice(0, index) : path;
};

interface DisplayMessageLike {
  children?: Array<{ id: string; tools?: Array<{ id: string; result_msg_id?: string }> }>;
  id: string;
  tools?: Array<{ id: string; result_msg_id?: string }>;
}

/**
 * Where the tool call that started a task sits in the displayed conversation:
 * the index to scroll to and the element id to highlight. A tool renders inside
 * its assistant group, so the group is the target.
 */
export const locateToolCall = (
  displayMessages: readonly DisplayMessageLike[],
  toolCallId: string,
): { elementId: string; index: number } | undefined => {
  const owns = (tools?: DisplayMessageLike['tools']) =>
    tools?.some((tool) => tool.id === toolCallId);
  const index = displayMessages.findIndex(
    (message) => owns(message.tools) || message.children?.some((child) => owns(child.tools)),
  );
  if (index < 0) return;
  return { elementId: displayMessages[index].id, index };
};
