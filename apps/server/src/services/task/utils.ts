import type { CheckpointConfig, TaskItem } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import { TRPCError } from '@trpc/server';
import isEqual from 'fast-deep-equal';

import { checkpointTaskPairsMatch } from '@/database/models/task/checkpoint';

import type { AiAgentService } from '../aiAgent';
import type { TaskServiceDeps } from './deps';

export const interruptTaskOperation = async (service: AiAgentService, operationId: string) => {
  const result = await service.interruptTask({ operationId });
  if (!result.success || result.deviceCancellationConfirmed === false) {
    throw new TRPCError({
      code: 'CONFLICT',
      message:
        'Task interruption was not confirmed. The execution remains active; retry stopping it before starting another attempt.',
    });
  }
};

export async function resolveTaskOrThrow(
  taskModel: TaskServiceDeps['taskModel'],
  ref: string,
): Promise<TaskItem> {
  if (!ref.trim())
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task reference must not be empty' });
  try {
    const task = await taskModel.resolve(ref);
    if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
    return task;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Ambiguous task reference:'))
      throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
    throw error;
  }
}

export async function resolveTasksOrThrow(
  taskModel: TaskServiceDeps['taskModel'],
  refs: string[],
  options: { duplicates: 'collapse' | 'reject' },
) {
  if (refs.some((ref) => !ref.trim()))
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task reference must not be empty' });
  const result = await taskModel.resolveRefs(refs);
  if (result.ambiguous.length)
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Ambiguous task references: ${result.ambiguous.join(', ')}`,
    });
  if (result.missing.length)
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `Task not found: ${result.missing.join(', ')}`,
    });
  if (options.duplicates === 'reject' && result.tasks.length !== refs.length) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Duplicate task references' });
  }
  return result;
}

/** Domain reads accept only canonical ids, preserving ownership and NOT_FOUND. */
export async function findTaskOrThrow(taskModel: TaskServiceDeps['taskModel'], taskId: string) {
  const task = await taskModel.findById(taskId);
  if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
  return task;
}

/** Input-only normalization; historical config is never reinterpreted on read. */
export async function normalizeCheckpointTaskRefs(
  taskModel: TaskServiceDeps['taskModel'],
  checkpoint: CheckpointConfig,
  previous?: CheckpointConfig,
) {
  if (!checkpoint.tasks) return checkpoint;
  const tasks = { ...checkpoint.tasks };
  const pending = (
    [
      ['beforeIds', 'beforeTasks'],
      ['afterIds', 'afterTasks'],
    ] as const
  ).filter(
    ([idsKey, pairsKey]) =>
      tasks[idsKey] !== undefined &&
      !checkpointTaskPairsMatch(tasks[idsKey], tasks[pairsKey]) &&
      // Whole-config round trips must not reinterpret unchanged legacy selections.
      // They can contain deleted tasks or exact historical values that never matched.
      !(
        tasks[pairsKey] === undefined &&
        previous?.tasks?.[pairsKey] === undefined &&
        isEqual(tasks[idsKey], previous?.tasks?.[idsKey])
      ),
  );
  if (!pending.length) return checkpoint;
  const resolved = await resolveTasksOrThrow(
    taskModel,
    pending.flatMap(([idsKey]) => tasks[idsKey]!),
    { duplicates: 'collapse' },
  );
  for (const [idsKey, pairsKey] of pending) {
    const selected = [
      ...new Map(
        tasks[idsKey]!.map((ref) => {
          const task = resolved.byRef.get(ref)!;
          return [task.id, task] as const;
        }),
      ).values(),
    ];
    tasks[idsKey] = selected.map((task) => task.identifier);
    tasks[pairsKey] = selected.map(({ id, identifier }) => ({ id, identifier }));
  }
  return { ...checkpoint, tasks };
}

export async function normalizeTaskConfig(
  taskModel: TaskServiceDeps['taskModel'],
  config: Record<string, unknown> | undefined,
  previous?: unknown,
) {
  if (!config?.checkpoint) return config;
  return {
    ...config,
    checkpoint: await normalizeCheckpointTaskRefs(
      taskModel,
      config.checkpoint as CheckpointConfig,
      isRecord(previous) ? (previous.checkpoint as CheckpointConfig | undefined) : undefined,
    ),
  };
}
