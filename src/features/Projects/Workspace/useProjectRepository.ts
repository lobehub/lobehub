import { useState } from 'react';

import { useProjectDirectoryStore, useProjectEnvironments } from '@/store/projectWorkingDirectory';

type ProjectEnvironment = ReturnType<typeof useProjectEnvironments>[number];

/** A linked environment a conversation can work in: one that names a repository. */
export const isRepositoryEnvironment = (environment: ProjectEnvironment) =>
  (environment.configuration?.sources ?? []).some((source) => source.kind === 'git');

/**
 * The project's repositories and the one a new conversation starts in: the
 * person's pick while it is still linked, otherwise the first. The server
 * applies the same default, so leaving it untouched and picking the first are
 * the same request.
 */
export const useProjectRepository = (
  projectId: string,
  /** A workspace-public agent applies published environments only; the server picks the same way. */
  sharedAgent = false,
) => {
  const { hasData } = useProjectDirectoryStore((s) => s.useFetchEnvironments)(projectId);
  const repositories = useProjectEnvironments(projectId).filter(
    (environment) =>
      isRepositoryEnvironment(environment) && (!sharedAgent || environment.visibility === 'public'),
  );
  const [pickedId, setPickedId] = useState<string>();
  const repository =
    repositories.find((environment) => environment.id === pickedId) ?? repositories[0];

  return { loaded: hasData, repositories, repository, setPickedId };
};
