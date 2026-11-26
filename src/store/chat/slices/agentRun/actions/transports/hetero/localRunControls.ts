import { isPermissionModeReport } from '@lobechat/heterogeneous-agents/claudeCodePermission/shared';
import { isCollaborationModeReport } from '@lobechat/heterogeneous-agents/codexPlanMode';

import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';
import {
  applyPermissionModeReport,
  registerLocalPermissionModeSwitcher,
} from '@/store/chat/heteroPermissionMode';
import {
  applyCollaborationModeReport,
  registerLocalCollaborationModeSwitcher,
} from '@/store/chat/heteroPlanMode';
import type { ChatStore } from '@/store/chat/store';

import { registerLocalBackgroundTaskStopper } from './backgroundTasks';

/**
 * Register the composer controls that reach a local run while it goes:
 * Claude Code's background-task stops and permission-mode chip, and the
 * native Codex Plan switch (the switcher fails when the run is `codex exec`,
 * and the pick then waits for the next run).
 *
 * @returns Unregister them all, or undefined when the agent has none.
 */
export const registerLocalRunControls = ({
  adapterType,
  operationId,
  sessionId,
  topicId,
}: {
  adapterType: string;
  operationId: string;
  sessionId: string;
  topicId: string | null | undefined;
}): (() => void) | undefined => {
  if (adapterType === 'codex') {
    return registerLocalCollaborationModeSwitcher(topicId, (mode) =>
      heterogeneousAgentService.setCollaborationMode(sessionId, mode),
    );
  }
  // Claude Code keeps its input (SDK stream or CLI stdin) open in every Follow-up mode.
  if (adapterType !== 'claude-code') return;
  const unregisterStopper = registerLocalBackgroundTaskStopper(operationId, (taskId) =>
    heterogeneousAgentService.stopBackgroundTask(sessionId, taskId),
  );
  // The mode chip switches this run's permission mode mid-run.
  const unregisterSwitcher = registerLocalPermissionModeSwitcher(topicId, (mode) =>
    heterogeneousAgentService.setPermissionMode(sessionId, mode),
  );
  return () => {
    unregisterStopper();
    unregisterSwitcher();
  };
};

/**
 * Apply a local run's mode report (Claude Code's permission mode, Codex's
 * collaboration mode) onto its topic. Resolves whether `data` was one.
 */
export const applyLocalModeReport = (
  get: () => ChatStore,
  topicId: string | null | undefined,
  data: unknown,
): boolean => {
  if (isPermissionModeReport(data)) {
    void applyPermissionModeReport(get, topicId, data, { persist: true });
    return true;
  }
  if (isCollaborationModeReport(data)) {
    void applyCollaborationModeReport(get, topicId, data, { persist: true });
    return true;
  }
  return false;
};
