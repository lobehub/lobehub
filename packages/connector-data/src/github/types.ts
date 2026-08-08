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

/** Ranking policies supported by the contributed-repository catalog. */
export type GitHubContributedRepositorySort = 'contributions' | 'recent' | 'stars';

/** Collection limits and ranking policy for recent GitHub contribution evidence. */
export interface GitHubContributionCollectionOptions {
  /** Maximum repository groups sampled per contribution kind before ranking. @default 100 */
  candidateRepositories?: number;
  /** Number of recent commit-contribution days sampled per repository. @default 3 */
  commitDaysPerRepository?: number;
  /** Maximum high-star contributed repositories retained as the influence perspective. @default 12 */
  maxInfluentialRepositories?: number;
  /** Maximum number of recent activity rows retained for the timeline. @default 40 */
  maxRecentContributions?: number;
  /** Maximum ranked repositories retained and enriched after aggregation. @default 24 */
  maxRepositories?: number;
  /** Number of recent PR, issue, and review events sampled per kind. @default 10 */
  recentEventsPerType?: number;
  /** Window used to rank current attention separately from annual contribution history. @default 90 */
  recentWindowDays?: number;
  /** Presentation order applied within the contribution-ranked shortlist. @default 'contributions' */
  sort?: GitHubContributedRepositorySort;
  /** Contribution history window measured backwards from collection time. @default 365 */
  windowDays?: number;
}

/** Activity totals attributed to a user within a contributed repository. */
export interface GitHubRepositoryContributionSummary {
  /** Number of commits credited by GitHub in the selected window. */
  commits: number;
  /** Number of issues opened in the selected window. */
  issues: number;
  /** Number of pull requests opened in the selected window. */
  pullRequests: number;
  /** Number of pull request reviews submitted in the selected window. */
  reviews: number;
  /** Sum of all supported contribution kinds in the selected window. */
  total: number;
}

/** Repository metadata enriched with the authenticated user's contribution summary. */
export interface GitHubContributedRepository extends GitHubRepository {
  /** GitHub-counted activity within the configured lookback window. */
  contributions: GitHubRepositoryContributionSummary;
  /** Most recent sampled contribution timestamp across supported contribution kinds. */
  lastContributionAt?: string;
}

export interface GitHubUserContext {
  /** Repositories associated with the user during the configured contribution window. */
  contributedRepositories?: GitHubContributedRepository[];
  /** High-star repositories to which GitHub attributes contribution in the selected window. */
  influentialRepositories?: GitHubContributedRepository[];
  organizations?: GitHubOrganization[];
  /** Pinned repositories corroborated by contribution totals in the selected window. */
  pinnedContributedRepositories?: GitHubContributedRepository[];
  pinnedRepositories?: GitHubRepository[];
  profile: GitHubUserProfile;
  profileReadme?: string;
  recentContributions?: GitHubContribution[];
  recentPullRequests?: GitHubPullRequest[];
  recentRepositories?: GitHubRepository[];
  repositoryContributors?: Record<string, GitHubRepositoryContributor[]>;
}
