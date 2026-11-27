'use client';

import { useEffect } from 'react';

import { resolveAgentProjectRunner } from '@/features/Projects/WorkingDirectories/agentProjectRunner';
import { canStageDraftOn } from '@/features/Projects/WorkingDirectories/startProjectTopicDraft';
import { useAgentFixedDeviceId } from '@/features/Projects/WorkingDirectories/useAgentFixedDeviceId';
import { useAgentOwnDevice } from '@/features/Projects/WorkingDirectories/useAgentOwnDevice';
import {
  isExecutionDirectoryAvailable,
  useProjectExecutionEnvironments,
} from '@/features/Projects/WorkingDirectories/useProjectExecutionEnvironments';
import { useChatStore } from '@/store/chat';
import { useDeviceList } from '@/store/device';

/**
 * The automatic choice for a blank project conversation, as the project home
 * composer offers it: the draft is staged on the first runner in the project's
 * order that can take it now, and follows that order while nothing is picked
 * by hand — a device that goes offline hands the draft to the next runner.
 * Picking a runner by hand restages the draft without `auto`, which ends it.
 *
 * A heterogeneous agent with a device of its own starts on that device's
 * directory instead (`resolveAgentProjectRunner`); `notice` says why it could
 * not, and whether the send will be refused.
 */
export const useBlankProjectAuto = (agentId: string, projectId: string | undefined) => {
  const { ordered } = useProjectExecutionEnvironments(projectId, !!projectId);
  const { data: devices } = useDeviceList();
  const fixedDeviceId = useAgentFixedDeviceId(agentId);
  const { loading: ownDeviceLoading, ownDevice } = useAgentOwnDevice(agentId);
  // The staged draft is global; only this project's draft is this composer's
  // to drive, or split panes on two projects would restage each other.
  const pending = useChatStore((s) => s.pendingNewTopicDirectory);
  const own =
    pending?.agentId === agentId &&
    (pending.projectWorkingDirectoryId
      ? ordered.some((environment) => environment.id === pending.projectWorkingDirectoryId)
      : !!projectId && pending.projectId === projectId)
      ? pending
      : undefined;
  const active = !!own?.auto;
  const staged = own ? (own.projectWorkingDirectoryId ?? 'sandbox') : undefined;

  // Until the member's device pick is known, Auto does not stage anything.
  const choice =
    projectId && ordered.length > 0 && !ownDeviceLoading
      ? resolveAgentProjectRunner(ordered, undefined, {
          isAvailable: (directory) =>
            canStageDraftOn(directory, fixedDeviceId) &&
            isExecutionDirectoryAvailable(directory, devices),
          isRunnable: (directory) => canStageDraftOn(directory, fixedDeviceId),
          ownDevice,
        })
      : undefined;
  const resolved = choice?.environment;

  const stage = () => {
    if (!projectId || !resolved) return;
    const { setPendingNewTopicDirectory } = useChatStore.getState();
    if (resolved.kind === 'directory') {
      setPendingNewTopicDirectory({ agentId, auto: true, projectWorkingDirectoryId: resolved.id });
      return;
    }
    // The send runs an Auto sandbox draft in the sandbox for that send only
    // (`resolveProjectDirectoryRun`); the agent's own target is left alone.
    setPendingNewTopicDirectory({ agentId, auto: true, projectId });
  };

  // While automatic, the draft follows the order as runners come and go.
  useEffect(() => {
    if (active && resolved && staged !== resolved.id) stage();
  }, [active, resolved?.id, staged]);

  const notice = choice?.ownDeviceUnavailable
    ? { blocked: !!choice.blocked, reason: choice.ownDeviceUnavailable }
    : undefined;

  return projectId && resolved ? { active, notice, onSelect: stage } : undefined;
};
