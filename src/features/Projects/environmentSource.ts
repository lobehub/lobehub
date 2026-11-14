import type { EnvironmentConfiguration } from '@lobechat/types';

interface EnvironmentLike {
  configuration?: Pick<EnvironmentConfiguration, 'sources'> | null;
  id: string;
  visibility?: string | null;
}

/** The repository an environment checks out, when it names one. */
export const environmentRepositoryUrl = (environment: EnvironmentLike): string | undefined => {
  const source = environment.configuration?.sources?.find((item) => item.kind === 'git');
  return source?.kind === 'git' ? source.url : undefined;
};

/**
 * The environments that can still be added to a project: not linked yet, and —
 * for a project whose conversations run a workspace-public agent — published,
 * since that agent applies nothing else.
 */
export const reusableEnvironments = <T extends EnvironmentLike>(
  available: T[],
  linked: { id: string }[],
  publish?: boolean,
): T[] =>
  available.filter(
    (environment) =>
      !linked.some((item) => item.id === environment.id) &&
      (!publish || environment.visibility === 'public'),
  );
