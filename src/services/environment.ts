import type { EnvironmentKind, EnvironmentSource, EnvironmentVisibility } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

/**
 * The part of a specification this API accepts today, and deliberately narrower
 * than `EnvironmentConfiguration`.
 *
 * `sources` is git-only because every other transport authenticates with a key,
 * and a specification documented as carrying no credentials cannot present one.
 * `requirements` is absent because nothing schedules on it yet — the server
 * would drop it without a word, and a field the types refuse is better than one
 * that quietly evaporates.
 */
export interface SandboxEnvironmentSpecification {
  bootstrapCommand?: string;
  env?: Record<string, string>;
  excludePaths?: string[];
  internetAccess?: boolean;
  kind?: EnvironmentKind;
  maintenanceCommand?: string;
  sources?: Extract<EnvironmentSource, { kind: 'git' }>[];
}

/**
 * Renderer-side data layer for code environments: the definitions a folder
 * can be initialized from. Answered from the database alone and available
 * without a drive — what is built from a definition lives on the drive and
 * goes through `sandboxStorageService`.
 */
class EnvironmentService {
  listEnvironments = async (params?: { visibility?: EnvironmentVisibility }) =>
    lambdaClient.environment.listEnvironments.query(params);

  /** The definition alone; folders are initialized from it in the directory picker. */
  createEnvironment = async (params: {
    configuration?: SandboxEnvironmentSpecification;
    description?: string;
    name: string;
    visibility?: EnvironmentVisibility;
  }) => lambdaClient.environment.createEnvironment.mutate(params);

  /**
   * Edits the specification. Existing instances keep the one they were created
   * with; the change shapes what the next instance is built from.
   */
  updateEnvironment = async (params: {
    configuration?: SandboxEnvironmentSpecification;
    description?: string;
    id: string;
    name?: string;
  }) => lambdaClient.environment.updateEnvironment.mutate(params);

  /**
   * Publishes an environment to the workspace, or takes it back.
   *
   * Separate from {@link updateEnvironment} because it changes who else can run
   * in what this environment built, not what the environment is.
   */
  setEnvironmentVisibility = async (params: { id: string; visibility: EnvironmentVisibility }) =>
    lambdaClient.environment.setEnvironmentVisibility.mutate(params);

  /** Refused while folders are still initialized from it — those go first. */
  removeEnvironment = async (params: { id: string }) =>
    lambdaClient.environment.removeEnvironment.mutate(params);

  /**
   * Repositories this account can build an environment from. Answers
   * `connected: false` rather than failing when GitHub is not linked — for the
   * picker that is a state to resolve, not an error.
   */
  listGithubRepositories = async () => lambdaClient.environment.listGithubRepositories.query();

  /** The branches of one repository, or `connected: false` when GitHub is not linked. */
  listGithubBranches = async (params: { owner: string; repository: string }) =>
    lambdaClient.environment.listGithubBranches.query(params);
}

export const environmentService = new EnvironmentService();
