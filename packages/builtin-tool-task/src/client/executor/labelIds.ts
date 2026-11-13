import { invertTaskLabelChange } from '@lobechat/types';

import { taskService } from '@/services/task';
import { taskLabelService } from '@/services/taskLabel';

import { resolveToolLabelIds } from '../../labels';

/** Label names → ids against the registry; throws a tool-readable message. */
export const resolveLabelIdsOrThrow = async (
  names: string[] | undefined,
  allowGroups = false,
): Promise<string[]> => {
  if (!names?.some((name) => name.trim())) return [];
  const result = resolveToolLabelIds(await taskLabelService.list(), names, { allowGroups });
  if (result.error) throw new Error(result.error);
  return result.ids;
};

const noop = async () => {};

/**
 * Apply a label delta ahead of a task's other edits, so a label failure stops
 * the edit before anything else is written. Returns an undo that reverses only
 * this delta (never a full-set replacement, so a teammate's concurrent label
 * change survives) for when a later write of the same edit fails. Pass
 * `withUndo: false` when nothing else follows, to skip the snapshot read.
 */
export const applyTaskLabelDelta = async (
  taskId: string,
  delta: { add: string[]; remove: string[] },
  withUndo: boolean,
): Promise<() => Promise<void>> => {
  if (delta.add.length === 0 && delta.remove.length === 0) return noop;
  const readLabels = async () => (await taskService.getDetail(taskId)).data?.labels ?? [];
  const before = withUndo ? await readLabels() : undefined;
  const after = (await taskLabelService.changeForTask(taskId, delta)).map((label) => label.id);
  if (!before) return noop;
  return async () => {
    try {
      // Re-read so a teammate's change made since is not rolled over.
      const undo = invertTaskLabelChange(before, delta, after, await readLabels());
      if (undo.add.length === 0 && undo.remove.length === 0) return;
      await taskLabelService.changeForTask(taskId, undo);
    } catch {
      /* best-effort: the edit already reports its own failure */
    }
  };
};
