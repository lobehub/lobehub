import type { taskRouter } from '@/server/routers/lambda/task';

// Stage functions for the runTask / runTasks dispatch (source-layout §4: a
// stage function takes an explicit deps object). Extracted from task.ts so
// the legacy runtime file — already over the 800-line limit — does not grow
// (AGENTS.md Code Style).

interface TaskRunDispatchDeps {
  // The dispatching run's device. When the calling session executes on a
  // device (local-system reads/writes working), a task topic spawned from it
  // must reach the same machine — its engagement/workspace paths live there —
  // instead of falling back to the assignee agent's stored target or the
  // cloud sandbox.
  activeDeviceId?: string;
  taskCaller: ReturnType<typeof taskRouter.createCaller>;
  // Default task when the caller omits the identifier (current task context).
  taskId?: string;
}

type TaskDispatchResult = { content: string; success: boolean };

export const runTaskDispatch = async (
  deps: TaskRunDispatchDeps,
  args: { continueTopicId?: string; identifier?: string; prompt?: string },
): Promise<TaskDispatchResult> => {
  const { activeDeviceId, taskId } = deps;
  const id = args.identifier?.trim() || taskId;
  if (!id) {
    return {
      content: 'No task identifier provided and no current task context.',
      success: false,
    };
  }

  try {
    // A continuation keeps the topic it continues on: turnSetup restores the
    // existing topic's metadata.boundDeviceId only when no device was
    // requested (execAgent: "routing topic %s to its bound device"), and an
    // explicit request would move an unpinned topic created on device A to
    // device B, stranding its device-local cwd / CLI session. Fresh topics
    // have no binding yet — that is where the dispatching run's device
    // inheritance applies. Same carve-outs as the fresh path: the task's own
    // pin (readTaskExecutionConfig) wins inside the runner, and an agent
    // whose selection policy is `fixed` overrides the request at plan
    // resolve.
    const continueTopicId = args.continueTopicId;
    const inheritDevice = !continueTopicId && !!activeDeviceId;
    const result = await deps.taskCaller.run({
      ...(continueTopicId ? { continueTopicId } : {}),
      // Inherit the dispatching run's device when it executes on one: a
      // task topic spawned from a device-routed session must reach the
      // same machine (its engagement/workspace paths live there), not
      // fall back to the assignee agent's stored target or the cloud
      // sandbox. Mirrors the callSubAgent device inheritance in
      // executorHelpers.buildServerVirtualSubAgentRunner.
      ...(inheritDevice ? { deviceId: activeDeviceId } : {}),
      id,
      prompt: args.prompt,
    });

    const topicId = (result as { topicId?: string } | undefined)?.topicId;
    const operationId = (result as { operationId?: string } | undefined)?.operationId;
    const lines = [`Task ${id} started.`];
    if (topicId) lines.push(`  Topic: ${topicId}`);
    if (operationId) lines.push(`  Operation: ${operationId}`);

    return { content: lines.join('\n'), success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run task';
    return { content: `Failed to run task ${id}: ${message}`, success: false };
  }
};

export const runTasksDispatch = async (
  deps: TaskRunDispatchDeps,
  args: { identifiers: string[] },
): Promise<TaskDispatchResult> => {
  const identifiers = Array.isArray(args.identifiers)
    ? args.identifiers.map((value) => value?.trim()).filter((value): value is string => !!value)
    : [];

  if (identifiers.length === 0) {
    return { content: 'No task identifiers provided.', success: false };
  }

  const lines: string[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const [index, identifier] of identifiers.entries()) {
    try {
      // Same device inheritance as runTask's fresh-topic path (runTasks never
      // continues a topic, so the continuation carve-out does not apply).
      const result = await deps.taskCaller.run({
        ...(deps.activeDeviceId ? { deviceId: deps.activeDeviceId } : {}),
        id: identifier,
      });
      const topicId = (result as { topicId?: string } | undefined)?.topicId;
      succeeded += 1;
      lines.push(`${index + 1}. ${identifier} — started${topicId ? ` (topic ${topicId})` : ''}`);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : 'Unknown error';
      lines.push(`${index + 1}. ${identifier} — failed: ${message}`);
    }
  }

  const header =
    failed === 0
      ? `Started ${succeeded} task${succeeded === 1 ? '' : 's'}:`
      : `Started ${succeeded}/${identifiers.length} tasks (${failed} failed):`;

  return {
    content: [header, ...lines].join('\n'),
    success: failed === 0,
  };
};
