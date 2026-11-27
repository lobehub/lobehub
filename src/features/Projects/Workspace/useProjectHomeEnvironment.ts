'use client';

import { useState } from 'react';

import { resolveAgentProjectRunner } from '@/features/Projects/WorkingDirectories/agentProjectRunner';
import { canStageDraftOn } from '@/features/Projects/WorkingDirectories/startProjectTopicDraft';
import { useAgentFixedDeviceId } from '@/features/Projects/WorkingDirectories/useAgentFixedDeviceId';
import { useAgentOwnDevice } from '@/features/Projects/WorkingDirectories/useAgentOwnDevice';
import {
  isExecutionDirectoryAvailable,
  useProjectExecutionEnvironments,
} from '@/features/Projects/WorkingDirectories/useProjectExecutionEnvironments';
import { useDeviceList } from '@/store/device';

/**
 * The project home composer's execution environment, picked among the
 * project's own execution environments as a project conversation's picker
 * offers them. Picking one only decides where this conversation starts; it
 * does not rewrite the agent's own execution target.
 */
export const useProjectHomeEnvironment = (projectId: string, agentId: string) => {
  const { directories, ordered } = useProjectExecutionEnvironments(projectId);
  const { data: devices } = useDeviceList();
  const fixedDeviceId = useAgentFixedDeviceId(agentId);
  const { loading: ownDeviceLoading, ownDevice } = useAgentOwnDevice(agentId);
  const [pickedId, setPickedId] = useState<string>();

  // A heterogeneous agent with a device of its own starts there first, as a
  // blank project conversation does (`useBlankProjectAuto`).
  const choice = resolveAgentProjectRunner(ordered, pickedId, {
    isAvailable: (directory) =>
      canStageDraftOn(directory, fixedDeviceId) &&
      isExecutionDirectoryAvailable(directory, devices),
    isRunnable: (directory) => canStageDraftOn(directory, fixedDeviceId),
    ownDevice,
  });
  const { environment } = choice;

  return {
    directories,
    /** The folder the conversation starts in; none in the cloud sandbox. */
    directoryId: environment.kind === 'directory' ? environment.id : undefined,
    onSandbox: environment.kind === 'sandbox',
    /** Nothing picked by hand: the project's order decides where it starts. */
    auto: pickedId === undefined,
    /** The agent's own device is still loading: Auto must not send yet. */
    loading: pickedId === undefined && ownDeviceLoading,
    /** Auto could not start on the agent's own device: why, and whether nothing else may. */
    notice: choice.ownDeviceUnavailable
      ? { blocked: !!choice.blocked, reason: choice.ownDeviceUnavailable }
      : undefined,
    pick: setPickedId,
    pickAuto: () => setPickedId(undefined),
  };
};
