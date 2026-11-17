import { useProjectDirectoryStore, useProjectEnvironments } from '@/store/projectWorkingDirectory';

type ProjectEnvironment = ReturnType<typeof useProjectEnvironments>[number];

/** A linked environment a conversation can work in: one that names a repository. */
export const isRepositoryEnvironment = (environment: ProjectEnvironment) =>
  (environment.configuration?.sources ?? []).some((source) => source.kind === 'git');

/**
 * The repository a new conversation starts in: the project's first one, the
 * same default the server applies.
 */
export const useProjectRepository = (
  projectId: string,
  /** A workspace-public agent applies published environments only; the server picks the same way. */
  sharedAgent = false,
) => {
  const { hasData } = useProjectDirectoryStore((s) => s.useFetchEnvironments)(projectId);
  const repository = useProjectEnvironments(projectId).find(
    (environment) =>
      isRepositoryEnvironment(environment) && (!sharedAgent || environment.visibility === 'public'),
  );

  return { loaded: hasData, repository };
};
