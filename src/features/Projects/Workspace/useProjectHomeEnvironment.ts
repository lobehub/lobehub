'use client';

import { useState } from 'react';

import {
  pickExecutionEnvironment,
  type ProjectExecutionEnvironment,
} from '@/features/Projects/WorkingDirectories/executionEnvironmentOrder';
import { canStageDraftOn } from '@/features/Projects/WorkingDirectories/startProjectTopicDraft';
import { useAgentFixedDeviceId } from '@/features/Projects/WorkingDirectories/useAgentFixedDeviceId';
import {
  isExecutionDirectoryAvailable,
  useProjectExecutionEnvironments,
} from '@/features/Projects/WorkingDirectories/useProjectExecutionEnvironments';
import { useDeviceList } from '@/store/device';
import type { ProjectDirectory } from '@/store/projectWorkingDirectory';

/**
 * The execution environment a new conversation from the project home starts
 * in: the person's pick while the project still has it, otherwise the first
 * one in the project's priority order that can take it now — the same rule
 * the project sidebar's "+" follows, so the two never start a conversation in
 * different places.
 */
export const resolveProjectHomeEnvironment = (
  ordered: readonly ProjectExecutionEnvironment[],
  pickedId: string | undefined,
  isAvailable: (directory: ProjectDirectory) => boolean,
): ProjectExecutionEnvironment =>
  (pickedId && ordered.find((environment) => environment.id === pickedId)) ||
  pickExecutionEnvironment(ordered, isAvailable);

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
  const [pickedId, setPickedId] = useState<string>();

  const environment = resolveProjectHomeEnvironment(
    ordered,
    pickedId,
    (directory) =>
      canStageDraftOn(directory, fixedDeviceId) &&
      isExecutionDirectoryAvailable(directory, devices),
  );

  return {
    directories,
    /** The folder the conversation starts in; none in the cloud sandbox. */
    directoryId: environment.kind === 'directory' ? environment.id : undefined,
    onSandbox: environment.kind === 'sandbox',
    /** Nothing picked by hand: the project's order decides where it starts. */
    auto: pickedId === undefined,
    pick: setPickedId,
    pickAuto: () => setPickedId(undefined),
  };
};
