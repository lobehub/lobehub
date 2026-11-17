import { stopClaudeCodeTask } from '@lobechat/heterogeneous-agents/spawn';

import { type HeteroControlHandler, registerHeteroControlHandler } from './heteroControl';

export { STOP_TASK_ANSWER_TIMEOUT_MS } from '@lobechat/heterogeneous-agents/spawn';

/** The control command the server queues to stop one background task. */
export const HETERO_STOP_TASK_COMMAND = 'stop_task';

/**
 * Stop one Claude Code background task: write a `stop_task` control request
 * into the session's stdin and wait for Claude Code to accept it. The stop is
 * only proven by the task's `stopped` report, which reaches the server through
 * the run's normal event stream; this reports that CC took the request.
 */
export const stopTaskHandler: HeteroControlHandler = async ({
  params,
  sendControlRequest,
  signal,
}) => {
  const taskId = (params as { taskId?: unknown } | null)?.taskId;
  if (typeof taskId !== 'string' || !taskId) throw new Error('stop_task needs a taskId');

  await stopClaudeCodeTask(sendControlRequest, taskId, { signal });
};

registerHeteroControlHandler(HETERO_STOP_TASK_COMMAND, stopTaskHandler);
