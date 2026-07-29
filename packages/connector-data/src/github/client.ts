import { createRecoverableMemo } from '../memo';
import type { GitHubConnectorTransport } from './graphql/client';
import { createGitHubGraphQLClient } from './graphql/client';
import {
  loadContributions,
  loadOrganizations,
  loadProfileBundle,
  loadProfileReadme,
  loadRepositories,
  loadRepositoryContributors,
  loadUserProfile,
} from './loaders';
import type {
  GitHubContribution,
  GitHubOrganization,
  GitHubPullRequest,
  GitHubRepository,
  GitHubRepositoryContributor,
  GitHubUserProfile,
} from './types';

export interface GitHubConnectorClient {
  getUserProfile: () => Promise<GitHubUserProfile>;
  getUserProfileReadme: () => Promise<string | undefined>;
  listPinnedRepositories: () => Promise<GitHubRepository[]>;
  listRecentContributions: () => Promise<GitHubContribution[]>;
  listRecentPullRequests: () => Promise<GitHubPullRequest[]>;
  listRecentRepositories: () => Promise<GitHubRepository[]>;
  listRepositoryContributors: (repository: string) => Promise<GitHubRepositoryContributor[]>;
  listUserOrganizations: () => Promise<GitHubOrganization[]>;
}

export interface CreateGitHubConnectorClientOptions {
  /** Authentication and protocol adapter used by the shared GitHub data loaders. */
  transport: GitHubConnectorTransport;
}

/**
 * Creates a GitHub connector from a required transport adapter.
 *
 * Use when:
 * - A provider adapter supplies the shared REST and GraphQL transport contract
 *
 * Expects:
 * - A fully initialized transport; authentication is handled by the provider adapter
 *
 * Returns:
 * - The stable domain-level GitHub connector interface
 */
export function createGitHubConnectorClient({
  transport,
}: CreateGitHubConnectorClientOptions): GitHubConnectorClient {
  const graphqlClient = createGitHubGraphQLClient(transport);
  const getProfileBundle = createRecoverableMemo(() => loadProfileBundle(graphqlClient));
  const getRepositories = createRecoverableMemo(() => loadRepositories(graphqlClient));

  return {
    getUserProfile: async () => loadUserProfile(await getProfileBundle(), transport),
    getUserProfileReadme: async () => {
      const { viewer } = await getProfileBundle();
      return loadProfileReadme(graphqlClient, viewer.login);
    },
    listPinnedRepositories: async () => (await getRepositories()).pinned,
    listRecentContributions: () => loadContributions(graphqlClient),
    listRecentPullRequests: async () => (await getRepositories()).pulls,
    listRecentRepositories: async () => (await getRepositories()).recent,
    listRepositoryContributors: (repository) => loadRepositoryContributors(transport, repository),
    listUserOrganizations: () => loadOrganizations(transport),
  };
}
