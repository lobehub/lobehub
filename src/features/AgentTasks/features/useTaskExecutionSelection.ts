'use client';

import type { TaskExecutionConfig, WorkingDirConfig } from '@lobechat/types';
import {
  applyTaskDirectorySelection,
  applyTaskReposSelection,
  applyTaskTargetSelection,
  hasTaskExecutionSelection,
} from '@lobechat/types';
import { useCallback, useState } from 'react';

import { type TaskRunTarget, useTaskRunTarget } from './useTaskRunTarget';

/**
 * The selection a task starts from when it stops following the agent: the
 * machine and folder its runs use right now, written down as the task's own.
 * Turning "follow" off therefore moves nothing until the user picks something
 * else — and from then on the agent changing its own environment no longer
 * moves the task.
 *
 * A machine outside the task's pool is left unpinned: a workspace task's
 * automated runs cannot reach a member's private device, and pinning it would
 * point every run at a machine they never resolve.
 */
export const seedTaskExecutionSelection = (
  target: Pick<TaskRunTarget, 'devices' | 'inheritedDeviceId' | 'inheritedDirectory'>,
): TaskExecutionConfig | undefined => {
  const { devices, inheritedDeviceId, inheritedDirectory } = target;
  if (!inheritedDeviceId || !devices?.some((device) => device.deviceId === inheritedDeviceId))
    return undefined;

  return inheritedDirectory
    ? applyTaskDirectorySelection(undefined, inheritedDirectory, inheritedDeviceId)
    : { boundDeviceId: inheritedDeviceId };
};

interface UseTaskExecutionSelectionParams {
  agentId: string;
  onChange: (execution?: TaskExecutionConfig) => void;
  value?: TaskExecutionConfig;
}

/**
 * The state behind the task execution controls: whether the task follows the
 * assignee agent, and how each picker turns into the next stored selection.
 *
 * One switch decides both axes — the agent's environment is a machine plus a
 * folder on it, so following one while picking the other was two controls for a
 * single decision. Following stores nothing; not following starts from the
 * agent's current machine and folder ({@link seedTaskExecutionSelection}).
 */
export const useTaskExecutionSelection = ({
  agentId,
  onChange,
  value,
}: UseTaskExecutionSelectionParams) => {
  const target = useTaskRunTarget(agentId, value?.boundDeviceId);
  const { deviceId, devices, inheritedDeviceId, inheritedDirectory } = target;

  // "Not following" with nothing picked yet — a cloud agent before any repo, or
  // a pin just removed — stores nothing, which is indistinguishable from
  // following. Held here so the pickers stay open until the user either picks
  // something or switches back.
  const [customizing, setCustomizing] = useState(false);
  const following = !customizing && !hasTaskExecutionSelection(value);

  // Every callback funnels through here so callers only ever receive `undefined`
  // ("inherit everything") or a selection with at least one real axis set —
  // never an object of empty values that would be persisted as a no-op.
  const emit = useCallback(
    (next?: TaskExecutionConfig) => {
      onChange(next && hasTaskExecutionSelection(next) ? next : undefined);
    },
    [onChange],
  );

  const changeFollowing = useCallback(
    (follow: boolean) => {
      setCustomizing(!follow);
      emit(
        follow
          ? undefined
          : seedTaskExecutionSelection({ devices, inheritedDeviceId, inheritedDirectory }),
      );
    },
    [devices, emit, inheritedDeviceId, inheritedDirectory],
  );

  const changeDevice = useCallback(
    (nextDeviceId?: string) => {
      const next = applyTaskTargetSelection(value, nextDeviceId);
      // Re-picking the target already in force is a no-op: the directory is
      // dropped on a target CHANGE, and a no-op that cleared it would delete a
      // directory the task legitimately holds.
      if (next === value) return;
      emit(next);
    },
    [emit, value],
  );

  const changeRepos = useCallback(
    (repos?: string[]) => {
      emit(applyTaskReposSelection(value, repos));
    },
    [emit, value],
  );

  const changeDirectory = useCallback(
    (config?: WorkingDirConfig) => {
      // The path lives on the run's machine; pin it so the directory never
      // travels to another target the agent later moves to.
      emit(applyTaskDirectorySelection(value, config, deviceId));
    },
    [deviceId, emit, value],
  );

  return { changeDevice, changeDirectory, changeFollowing, changeRepos, following, target };
};
