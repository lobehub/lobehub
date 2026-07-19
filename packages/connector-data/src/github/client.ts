import type { GitHubConnectorTransport } from './graphql/client';
import { createGitHubGraphQLClient, createOctokitTransport } from './graphql/client';
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
  accessToken: string;
  /** @internal Tests and custom protocol adapters only. */
  transport?: GitHubConnectorTransport;
}

const createRecoverableMemo = <T>(load: () => Promise<T>) => {
  let promise: Promise<T> | undefined;

  return () => {
    promise ??= load().catch((error) => {
      promise = undefined;
      throw error;
    });
    return promise;
  };
};

export const createGitHubConnectorClient = ({
  accessToken,
  transport = createOctokitTransport(accessToken),
}: CreateGitHubConnectorClientOptions): GitHubConnectorClient => {
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
    listUserOrganizations: () => loadOrganizations(graphqlClient),
  };
};
