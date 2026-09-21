'use client';

import type { TaskExecutionConfig } from '@lobechat/types';
import { applyTaskReposSelection, hasTaskExecutionSelection } from '@lobechat/types';
import { memo, useCallback } from 'react';

import { useEffectiveAgentMode } from '@/features/ChatInput/hooks/useEffectiveAgentMode';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import TaskDeviceChip from './TaskDeviceChip';
import TaskRepoChip from './TaskRepoChip';

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
 * Two chips, matching the two axes the run contract can actually honour:
 *
 * - **run location** — pin a machine, or follow the assignee agent. Always
 *   shown for an agent that has an execution environment at all.
 * - **working directory** — a repo selection. The chip hides itself on any
 *   surface where a repo identifier would not be the directory the run uses.
 *
 * Everything the task leaves unset falls back to the assignee agent, so a task
 * created without touching either chip behaves exactly as tasks did before this
 * existed.
 */
const TaskExecutionControls = memo<TaskExecutionControlsProps>((props) => {
  const { assigneeAgentId } = props;
  if (!assigneeAgentId) return null;
  return <TaskExecutionControlsInner {...props} assigneeAgentId={assigneeAgentId} />;
});

const TaskExecutionControlsInner = memo<
  Omit<TaskExecutionControlsProps, 'assigneeAgentId'> & { assigneeAgentId: string }
>(({ assigneeAgentId, disabled, onChange, value }) => {
  const isHetero = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(assigneeAgentId));
  const { isAgentRuntimeMode, isPreferenceLoading } = useEffectiveAgentMode(assigneeAgentId);
  // Heterogeneous agents always execute somewhere; a plain agent only has an
  // execution environment in agent mode (chat mode means "no tools, no device").
  // Same gate the chat composer uses for this cluster.
  const canExecuteSomewhere = isHetero || isAgentRuntimeMode;

  // Both callbacks funnel through here so callers only ever receive `undefined`
  // ("inherit everything") or a selection with at least one real axis set —
  // never an object of empty values that would be persisted as a no-op.
  const emit = useCallback(
    (next: TaskExecutionConfig) => {
      onChange(hasTaskExecutionSelection(next) ? next : undefined);
    },
    [onChange],
  );

  const handleDeviceChange = useCallback(
    (deviceId?: string) => {
      emit({ ...value, boundDeviceId: deviceId });
    },
    [emit, value],
  );

  const handleReposChange = useCallback(
    (repos?: string[]) => {
      emit(applyTaskReposSelection(value, repos));
    },
    [emit, value],
  );

  if (isPreferenceLoading || !canExecuteSomewhere) return null;

  return (
    <>
      <TaskDeviceChip
        agentId={assigneeAgentId}
        disabled={disabled}
        value={value?.boundDeviceId}
        onChange={handleDeviceChange}
      />
      <TaskRepoChip
        agentId={assigneeAgentId}
        disabled={disabled}
        value={value?.repos}
        onChange={handleReposChange}
      />
    </>
  );
});

TaskExecutionControlsInner.displayName = 'TaskExecutionControls.Inner';

export default TaskExecutionControls;
