'use client';

import type { TaskExecutionConfig, WorkingDirConfig } from '@lobechat/types';
import {
  applyTaskDirectorySelection,
  applyTaskReposSelection,
  applyTaskTargetSelection,
  getWorkingDirEffectivePath,
  hasTaskExecutionSelection,
} from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { FolderIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useEffectiveAgentMode } from '@/features/ChatInput/hooks/useEffectiveAgentMode';
import {
  getWorkingDirectoryName,
  getWorkingDirectoryPathString,
} from '@/helpers/workingDirectoryPath';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import TaskDeviceChip from './TaskDeviceChip';
import { taskExecutionStyles as styles } from './taskExecutionStyles';
import TaskRepoChip from './TaskRepoChip';
import TaskWorkingDirectoryChip from './TaskWorkingDirectoryChip';
import { useTaskRunTarget } from './useTaskRunTarget';

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
 * Two axes, and the second one is decided by the first:
 *
 * - **run location** — pin a machine, or follow the assignee agent.
 * - **working directory** — expressed in the units of the target the run lands
 *   on: an absolute path when it lands on a machine, a cloud repo identifier
 *   when it lands in the sandbox. When the target leaves nothing choosable the
 *   directory is reported as a muted line instead of an interactive control.
 *
 * Everything the task leaves unset falls back to the assignee agent, so a task
 * created without touching either axis behaves exactly as tasks did before this
 * existed. Changing the target clears the directory, because the two describe
 * the same thing in different units — a leftover selection would be a path the
 * cloud run cannot use, or a repo name nothing on the machine resolves. Re-picking
 * the target already in force is a no-op, so the checked row never deletes a
 * directory the task holds.
 */
const TaskExecutionControls = memo<TaskExecutionControlsProps>((props) => {
  const { assigneeAgentId } = props;
  if (!assigneeAgentId) return null;
  return <TaskExecutionControlsInner {...props} assigneeAgentId={assigneeAgentId} />;
});

const TaskExecutionControlsInner = memo<
  Omit<TaskExecutionControlsProps, 'assigneeAgentId'> & { assigneeAgentId: string }
>(({ assigneeAgentId, disabled, onChange, value }) => {
  const { t } = useTranslation('chat');
  const isHetero = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(assigneeAgentId));
  const { isAgentRuntimeMode, isPreferenceLoading } = useEffectiveAgentMode(assigneeAgentId);
  // Heterogeneous agents always execute somewhere; a plain agent only has an
  // execution environment in agent mode (chat mode means "no tools, no device").
  // Same gate the chat composer uses for this cluster.
  const canExecuteSomewhere = isHetero || isAgentRuntimeMode;

  const target = useTaskRunTarget(assigneeAgentId, value?.boundDeviceId);

  // Both callbacks funnel through here so callers only ever receive `undefined`
  // ("inherit everything") or a selection with at least one real axis set —
  // never an object of empty values that would be persisted as a no-op.
  const emit = useCallback(
    (next?: TaskExecutionConfig) => {
      onChange(next && hasTaskExecutionSelection(next) ? next : undefined);
    },
    [onChange],
  );

  const handleDeviceChange = useCallback(
    (deviceId?: string) => {
      const next = applyTaskTargetSelection(value, deviceId);
      // Re-picking the target already in force is a no-op: the directory is
      // dropped on a target CHANGE, and a no-op that cleared it would delete a
      // directory the task legitimately holds (an explicit directory on an
      // agent-bound device, or the checked "Follow the agent" row).
      if (next === value) return;
      emit(next);
    },
    [emit, value],
  );

  const handleReposChange = useCallback(
    (repos?: string[]) => {
      emit(applyTaskReposSelection(value, repos));
    },
    [emit, value],
  );

  const handleDirectoryChange = useCallback(
    (config?: WorkingDirConfig) => {
      emit(applyTaskDirectorySelection(value, config));
    },
    [emit, value],
  );

  if (isPreferenceLoading || !canExecuteSomewhere) return null;

  // What the run actually starts in: the task's own choice first, then the
  // chain the runtime falls back to. Shown as the muted hint so "inherit" is
  // legible as a concrete directory instead of a black box.
  const selectedDirectory =
    getWorkingDirEffectivePath(value?.workingDirectoryConfig) ??
    getWorkingDirectoryPathString(value?.workingDirectory);
  const effectiveDirectory = selectedDirectory ?? target.inheritedDirectory?.path;
  const directorySummary = effectiveDirectory
    ? (getWorkingDirectoryName(effectiveDirectory) ?? effectiveDirectory)
    : t('taskExecution.followAgent');

  return (
    <>
      <TaskDeviceChip
        agentId={assigneeAgentId}
        directoryHint={directorySummary}
        disabled={disabled}
        value={value?.boundDeviceId}
        onChange={handleDeviceChange}
      />
      {target.directoryKind === 'device' && target.deviceId ? (
        <TaskWorkingDirectoryChip
          deviceId={target.deviceId}
          disabled={disabled}
          value={value?.workingDirectoryConfig}
          onChange={handleDirectoryChange}
        />
      ) : target.directoryKind === 'repo' ? (
        <TaskRepoChip
          agentId={assigneeAgentId}
          disabled={disabled}
          value={value?.repos}
          onChange={handleReposChange}
        />
      ) : (
        <Flexbox horizontal align={'center'} className={styles.hint} gap={4}>
          <Icon icon={FolderIcon} size={12} />
          <span>{t('taskExecution.workingDirectory')}</span>
          <span className={styles.hintValue}>· {directorySummary}</span>
        </Flexbox>
      )}
    </>
  );
});

TaskExecutionControlsInner.displayName = 'TaskExecutionControls.Inner';

export default TaskExecutionControls;
