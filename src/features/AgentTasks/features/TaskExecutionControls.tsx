'use client';

import type { TaskExecutionConfig } from '@lobechat/types';
import { getWorkingDirEffectivePath } from '@lobechat/types';
import { memo } from 'react';

import { getWorkingDirectoryName } from '@/helpers/workingDirectoryPath';

import TaskDeviceChip from './TaskDeviceChip';
import TaskRepoChip from './TaskRepoChip';
import TaskWorkingDirectoryChip from './TaskWorkingDirectoryChip';
import { useTaskExecutionAvailability } from './useTaskExecutionAvailability';
import { useTaskExecutionSelection } from './useTaskExecutionSelection';

interface TaskExecutionControlsProps {
  /** The assignee whose execution environment a task inherits by default. */
  assigneeAgentId?: string;
  disabled?: boolean;
  onChange: (execution?: TaskExecutionConfig) => void;
  /** The task's current selection; empty means "inherit the agent". */
  value?: TaskExecutionConfig;
}

/**
 * Where this task will run, next to the other task properties.
 *
 * One switch decides it: **follow the agent**, and the task runs on the
 * assignee's machine in the assignee's folder — both axes, because the agent's
 * environment is one thing; or **don't**, and the task picks both itself:
 *
 * - **run location** — a machine from the task's pool (or the agent's own
 *   target when that is not a machine, e.g. the cloud sandbox).
 * - **working directory** — expressed in the units of the target the run lands
 *   on: an absolute path when it lands on a machine, a cloud repo identifier
 *   when it lands in the sandbox.
 *
 * A task left on "follow" stores nothing, so it behaves exactly as tasks did
 * before this existed. Changing the target clears the directory, because the
 * two describe the same thing in different units — a leftover selection would
 * be a path the cloud run cannot use, or a repo name nothing on the machine
 * resolves. See {@link useTaskExecutionSelection} for the state behind it.
 */
const TaskExecutionControls = memo<TaskExecutionControlsProps>((props) => {
  const { assigneeAgentId } = props;
  if (!assigneeAgentId) return null;
  // Keyed by the assignee: "not following" is a decision about ONE agent's
  // environment, and must not carry over to the next agent picked.
  return (
    <TaskExecutionControlsInner
      key={assigneeAgentId}
      {...props}
      assigneeAgentId={assigneeAgentId}
    />
  );
});

const TaskExecutionControlsInner = memo<
  Omit<TaskExecutionControlsProps, 'assigneeAgentId'> & { assigneeAgentId: string }
>(({ assigneeAgentId, disabled, onChange, value }) => {
  const canExecuteSomewhere = useTaskExecutionAvailability(assigneeAgentId);
  const { changeDevice, changeDirectory, changeFollowing, changeRepos, following, target } =
    useTaskExecutionSelection({ agentId: assigneeAgentId, onChange, value });

  if (!canExecuteSomewhere) return null;

  // While following, `inheritedDirectory` is the agent's own folder on its own
  // machine — shown under the switch so "follow" reads as a concrete place.
  const followDirectory = getWorkingDirEffectivePath(target.inheritedDirectory);

  return (
    <>
      <TaskDeviceChip
        agentId={assigneeAgentId}
        disabled={disabled}
        following={following}
        value={value?.boundDeviceId}
        followDirectory={
          followDirectory
            ? (getWorkingDirectoryName(followDirectory) ?? followDirectory)
            : undefined
        }
        onChange={changeDevice}
        onFollowChange={changeFollowing}
      />
      {!following &&
        (target.directoryKind === 'device' && target.deviceId ? (
          <TaskWorkingDirectoryChip
            deviceId={target.deviceId}
            disabled={disabled || target.isPending}
            fallback={target.inheritedDirectory}
            value={value?.workingDirectoryConfig}
            onChange={changeDirectory}
          />
        ) : target.directoryKind === 'repo' ? (
          <TaskRepoChip
            agentId={assigneeAgentId}
            disabled={disabled}
            value={value?.repos}
            onChange={changeRepos}
          />
        ) : null)}
    </>
  );
});

TaskExecutionControlsInner.displayName = 'TaskExecutionControls.Inner';

export default TaskExecutionControls;
