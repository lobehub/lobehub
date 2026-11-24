import { type ReactNode } from 'react';

import AsyncError from '@/components/AsyncError';
import {
  repositoriesLabel,
  repositorySlug,
} from '@/features/ChatInput/ControlBar/sandboxEnvironmentOptions';
import EnvironmentForm, {
  type EnvironmentFormValue,
} from '@/features/EnvironmentManager/EnvironmentForm';
import EnvironmentSummary from '@/features/EnvironmentManager/EnvironmentSummary';
import { EnvironmentListSkeleton } from '@/features/EnvironmentManager/Skeleton';
import type { SandboxEnvironmentSpecification } from '@/services/environment';
import { useProjectDirectoryStore, useProjectEnvironments } from '@/store/projectWorkingDirectory';

import { ExecutionEnvironments } from './ExecutionEnvironments';

interface ProjectWorkingDirectoriesProps {
  /** Whether the caller may change the project, and so its environment. */
  canManage?: boolean;
  projectId: string;
}

/**
 * The project's execution environments, in the priority a new conversation
 * follows: the cloud sandbox — whose row unfolds into the project's
 * environment, the repositories it clones, the setup that runs and the
 * variables every command sees — and the device folders someone added.
 */
export function ProjectWorkingDirectories({
  canManage,
  projectId,
}: ProjectWorkingDirectoriesProps) {
  const request = useProjectDirectoryStore((s) => s.useFetchEnvironments)(projectId);
  const updateEnvironment = useProjectDirectoryStore((s) => s.updateProjectEnvironment);
  const [environment] = useProjectEnvironments(projectId);

  const save = async (changes: {
    configuration?: SandboxEnvironmentSpecification;
    description?: string;
  }) => {
    await updateEnvironment({
      projectId,
      ...(changes.configuration && { configuration: changes.configuration }),
      ...(changes.description !== undefined && { description: changes.description }),
    });
  };

  let cloud: ReactNode;
  if (request.error && !environment) {
    cloud = <AsyncError error={request.error} onRetry={() => request.revalidate()} />;
  } else if (!request.hasData || !environment) {
    cloud = <EnvironmentListSkeleton />;
  } else {
    const value: EnvironmentFormValue = environment;
    cloud = canManage ? (
      <EnvironmentForm
        collapseSetup
        hideBasics
        hideRepositoryHints
        environment={value}
        onSave={save}
      />
    ) : (
      <EnvironmentSummary environment={value} />
    );
  }

  // The sandbox is told apart by the repositories it clones: their name and
  // the first one's logo on its card.
  const sandboxRepository = environment
    ? { label: repositoriesLabel(environment), slug: repositorySlug(environment) }
    : undefined;

  return (
    <ExecutionEnvironments
      canManage={!!canManage}
      environmentId={environment?.id}
      projectId={projectId}
      sandboxDetails={cloud}
      sandboxRepository={sandboxRepository}
    />
  );
}
