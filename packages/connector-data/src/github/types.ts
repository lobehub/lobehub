export interface GitHubUserProfile {
  bio?: string;
  company?: string;
  externalAccountId: string;
  location?: string;
  login: string;
  name?: string;
  pronouns?: string;
  websiteUrl?: string;
}

export interface GitHubOrganization {
  description?: string;
  followerCount?: number;
  login?: string;
  name?: string;
  repositoryCount?: number;
}

export interface GitHubRepository {
  description?: string;
  forkCount?: number;
  issueCount?: number;
  nameWithOwner: string;
  primaryLanguage?: string;
  pullRequestCount?: number;
  pushedAt?: string;
  stargazerCount?: number;
  topics: string[];
}

export interface GitHubPullRequest {
  number?: number;
  repository?: string;
  title?: string;
  updatedAt?: string;
}

export interface GitHubRepositoryContributor {
  contributionCount?: number;
  login?: string;
}

export interface GitHubContribution {
  count?: number;
  occurredAt?: string;
  repository?: string;
  title: string;
  type: 'commit' | 'issue' | 'pull_request' | 'pull_request_review';
}

export interface GitHubUserContext {
  organizations?: GitHubOrganization[];
  pinnedRepositories?: GitHubRepository[];
  profile: GitHubUserProfile;
  profileReadme?: string;
  recentContributions?: GitHubContribution[];
  recentPullRequests?: GitHubPullRequest[];
  recentRepositories?: GitHubRepository[];
  repositoryContributors?: Record<string, GitHubRepositoryContributor[]>;
}
