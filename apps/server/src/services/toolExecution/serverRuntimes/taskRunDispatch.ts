import { readTaskExecutionConfig, type TaskExecutionConfig, type TaskItem } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

import { resolveTaskOrThrow } from '@/server/services/task/utils';

import type { TaskRuntimeDeps } from './task';
import { taskResult, taskResultLabel } from './taskResults';

// Stage functions for the runTask / runTasks dispatch (source-layout §4: a
// stage function takes an explicit deps object). Extracted from task.ts so
// the legacy runtime file — already near the 1200-line limit — does not grow
// (AGENTS.md Code Style). Reads `deps` lazily: the runtime factory swaps its
// models and callers in after the first call resolves the owning scope.

type TaskRunDispatchDeps = Pick<
  TaskRuntimeDeps,
  // The dispatching run's device. When the calling session executes on a
  // device (local-system reads/writes working), a task topic spawned from it
  // must reach the same machine — its engagement/workspace paths live there —
  // instead of falling back to the assignee agent's stored target or the
  // cloud sandbox.
  | 'activeDeviceId'
  | 'taskCaller'
  // Default task when the caller omits the identifier (current task context).
  | 'taskId'
  | 'taskModel'
>;

// `TaskItem.config` is untyped jsonb (`unknown`); the reader validates every
// field itself and degrades malformed shapes to "inherit".
const taskExecutionOf = (task: TaskItem): TaskExecutionConfig | undefined =>
  readTaskExecutionConfig(isRecord(task.config) ? (task.config as Record<string, unknown>) : null);

export const runTaskDispatch = async (
  deps: TaskRunDispatchDeps,
  args: {
    continueTopicId?: string;
    identifier?: string;
    model?: string;
    prompt?: string;
    provider?: string;
  },
) => {
  const { activeDeviceId, taskId } = deps;
  const id = args.identifier?.trim() || taskId;
  if (!id) {
    return {
      content: 'No task identifier provided and no current task context.',
      success: false,
    };
  }

  try {
    const task = await resolveTaskOrThrow(deps.taskModel, id);
    // A continuation keeps the topic it continues on: turnSetup restores the
    // existing topic's metadata.boundDeviceId only when no device was
    // requested (execAgent: "routing topic %s to its bound device"), and an
    // explicit request would move an unpinned topic created on device A to
    // device B, stranding its device-local cwd / CLI session. Fresh topics
    // have no binding yet — that is where the dispatching run's device
    // inheritance applies.
    const continueTopicId = args.continueTopicId;
    // A task's own execution pin outranks the inherited context. The task
    // caller forwards this deviceId as the run's requested device, and
    // `resolveRunDeviceId` gives the request precedence over
    // `execution.boundDeviceId` — an inherited device would win over the pin
    // and `resolveTaskRunExecution` would then drop the pin's working
    // directory (it may only travel with its own machine). So inherit only
    // when the task pins nothing: the pin keeps full authority over both the
    // device and its cwd. A `fixed` agent selection policy still overrides
    // any request at plan resolve. Mirrors the callSubAgent device
    // inheritance in executorHelpers.buildServerVirtualSubAgentRunner.
    const inheritDevice = !continueTopicId && !!activeDeviceId && !taskExecutionOf(task);
    const result = await deps.taskCaller.run({
      ...(continueTopicId ? { continueTopicId } : {}),
      // Inherit the dispatching run's device when it executes on one: a task
      // topic spawned from a device-routed session must reach the same
      // machine (its engagement/workspace paths live there), not fall back to
      // the assignee agent's stored target or the cloud sandbox.
      ...(inheritDevice ? { deviceId: activeDeviceId } : {}),
      id: task.id,
      model: args.model,
      prompt: args.prompt,
      provider: args.provider,
    });

    const topicId = (result as { topicId?: string } | undefined)?.topicId;
    const operationId = (result as { operationId?: string } | undefined)?.operationId;
    const lines = [`Task ${taskResultLabel(task)} started.`];
    if (topicId) lines.push(`  Topic: ${topicId}`);
    if (operationId) lines.push(`  Operation: ${operationId}`);

    return taskResult(task, lines.join('\n'), { topicId, operationId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run task';
    return { content: `Failed to run task ${id}: ${message}`, success: false };
  }
};

export const runTasksDispatch = async (
  deps: TaskRunDispatchDeps,
  args: { identifiers: string[]; model?: string; provider?: string },
) => {
  const identifiers = Array.isArray(args.identifiers)
    ? args.identifiers.filter(
        (value): value is string => typeof value === 'string' && !!value.trim(),
      )
    : [];

  if (identifiers.length === 0) {
    return { content: 'No task identifiers provided.', success: false };
  }

  const resolved = await deps.taskModel.resolveRefs(identifiers);
  if (resolved.ambiguous.length)
    throw new Error(`Ambiguous task references: ${resolved.ambiguous.join(', ')}`);
  const results: {
    taskId?: string;
    identifier?: string;
    refs: string[];
    success: boolean;
    error?: string;
  }[] = [];
  for (const task of resolved.tasks) {
    const refs = identifiers.filter((ref) => resolved.byRef.get(ref)?.id === task.id);
    try {
      // Same inheritance rules as runTask's fresh-topic path (runTasks never
      // continues a topic): inherit only when the task carries no execution
      // pin, so a pin keeps both its device and its working directory.
      const inheritDevice = !!deps.activeDeviceId && !taskExecutionOf(task);
      await deps.taskCaller.run({
        ...(inheritDevice ? { deviceId: deps.activeDeviceId } : {}),
        id: task.id,
        model: args.model,
        provider: args.provider,
      });
      results.push({ taskId: task.id, identifier: task.identifier, refs, success: true });
    } catch (error) {
      results.push({
        taskId: task.id,
        identifier: task.identifier,
        refs,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  for (const ref of resolved.missing)
    results.push({ refs: [ref], success: false, error: `Task not found: ${ref}` });
  const succeeded = results.filter((result) => result.success).length;
  const failed = results.length - succeeded;
  return {
    content: [
      `Started ${succeeded}/${results.length} tasks (${failed} failed):`,
      ...results.map(
        (result) =>
          `${result.identifier ?? result.refs[0]}${result.taskId ? ` (id: ${result.taskId})` : ''} — ${result.success ? 'started' : `failed: ${result.error}`}`,
      ),
    ].join('\n'),
    state: { results, succeeded, failed },
    success: failed === 0,
  };
};
