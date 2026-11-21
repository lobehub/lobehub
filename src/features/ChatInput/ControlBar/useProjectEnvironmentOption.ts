import { useSyncExternalStore } from 'react';

import {
  getPendingSandboxSelection,
  isSeededSandboxSelection,
  subscribePendingSandboxSelection,
} from '@/store/chat/pendingSandboxSelection';

import { projectStartEnvironmentId } from './sandboxEnvironmentOptions';
import { useIsSharedAgent, useProjectSandboxEnvironments } from './useSandboxEnvironmentList';
import { isPersistentSelection, useSandboxPlacement } from './useSandboxPlacement';

/**
 * A project conversation's own execution environment: a cloud sandbox set up
 * from the project's environment — its repositories, setup and variables.
 *
 * It is what a new project conversation runs in when nobody picked anything:
 * the server applies the project's environment over a default placement (see
 * `withProjectSandbox`), so before the first message it reads as selected,
 * and the chips say what the run will really get. Undefined outside a
 * project, or when the project's environment clones nothing a sandbox may.
 */
export const useProjectEnvironmentOption = (agentId: string, topicId: string | null) => {
  const { projectId, selection, setSelection } = useSandboxPlacement(agentId, topicId);
  const sharedAgent = useIsSharedAgent(agentId);
  const { environments } = useProjectSandboxEnvironments(projectId, sharedAgent);
  const environmentId = projectStartEnvironmentId(environments);
  const environment = environments.find((item) => item.id === environmentId);
  const pending = useSyncExternalStore(subscribePendingSandboxSelection, () =>
    getPendingSandboxSelection(agentId),
  );

  /** A new conversation nobody placed: the project's environment is its default. */
  const projectDefault =
    !!environment && !topicId && (!pending || isSeededSandboxSelection(pending));
  const selected =
    !!environment &&
    (projectDefault ||
      (selection.environmentId === environment.id && !isPersistentSelection(selection)));

  /** Run in a temporary sandbox set up from the project's environment. */
  const apply = async () => {
    if (environment) await setSelection({ environmentId: environment.id });
  };

  return { apply, environment, projectDefault, selected };
};
