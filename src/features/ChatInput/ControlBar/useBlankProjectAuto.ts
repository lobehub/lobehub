'use client';

import { useEffect, useRef } from 'react';

import { useSelectExecutionTarget } from '@/features/ChatInput/hooks/useSelectExecutionTarget';
import { canStageDraftOn } from '@/features/Projects/WorkingDirectories/startProjectTopicDraft';
import { useAgentFixedDeviceId } from '@/features/Projects/WorkingDirectories/useAgentFixedDeviceId';
import {
  isExecutionDirectoryAvailable,
  useProjectExecutionEnvironments,
} from '@/features/Projects/WorkingDirectories/useProjectExecutionEnvironments';
import { resolveProjectHomeEnvironment } from '@/features/Projects/Workspace/useProjectHomeEnvironment';
import { useChatStore } from '@/store/chat';
import { useDeviceList } from '@/store/device';

/**
 * The automatic choice for a blank project conversation, as the project home
 * composer offers it: the draft is staged on the first runner in the project's
 * order that can take it now, and follows that order while nothing is picked
 * by hand — a device that goes offline hands the draft to the next runner.
 * Picking a runner by hand restages the draft without `auto`, which ends it.
 */
export const useBlankProjectAuto = (agentId: string, projectId: string | undefined) => {
  const { ordered } = useProjectExecutionEnvironments(projectId, !!projectId);
  const { data: devices } = useDeviceList();
  const fixedDeviceId = useAgentFixedDeviceId(agentId);
  const selectExecutionTarget = useSelectExecutionTarget(agentId);
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

  const resolved =
    projectId && ordered.length > 0
      ? resolveProjectHomeEnvironment(
          ordered,
          undefined,
          (directory) =>
            canStageDraftOn(directory, fixedDeviceId) &&
            isExecutionDirectoryAvailable(directory, devices),
        )
      : undefined;

  // The agent is sent to the sandbox once per stay there, whether Auto moved
  // the draft there or found it there (a "+" that resolved to the sandbox).
  const sandboxTargetedRef = useRef(false);
  const targetSandbox = () => {
    sandboxTargetedRef.current = true;
    // Same as picking the sandbox by hand: the first send must not land on a device.
    void selectExecutionTarget('sandbox');
  };

  const stage = () => {
    if (!projectId || !resolved) return;
    const { setPendingNewTopicDirectory } = useChatStore.getState();
    if (resolved.kind === 'directory') {
      setPendingNewTopicDirectory({ agentId, auto: true, projectWorkingDirectoryId: resolved.id });
      return;
    }
    setPendingNewTopicDirectory({ agentId, auto: true, projectId });
    targetSandbox();
  };

  // While automatic, the draft follows the order as runners come and go.
  useEffect(() => {
    if (staged !== 'sandbox') sandboxTargetedRef.current = false;
    if (!active || !resolved) return;
    if (staged !== resolved.id) stage();
    else if (staged === 'sandbox' && !sandboxTargetedRef.current) targetSandbox();
  }, [active, resolved?.id, staged]);

  return projectId && resolved ? { active, onSelect: stage } : undefined;
};
