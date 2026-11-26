/** One public repository from GitHub's repository search. */
export interface GithubRepoHit {
  avatar: string;
  description: string | null;
  fullName: string;
  stars: number;
  url: string;
}

/** GitHub allows ten anonymous searches a minute; past that it answers 403/429. */
export class GithubSearchLimitError extends Error {
  constructor() {
    super('GitHub search rate limit reached');
    this.name = 'GithubSearchLimitError';
  }
}

interface SearchResponse {
  items?: Array<{
    description: string | null;
    full_name: string;
    html_url: string;
    owner?: { avatar_url?: string };
    stargazers_count: number;
  }>;
}

/**
 * Public GitHub repositories that look like they hold skills for `query`. The
 * word "skill" narrows the search to repositories that call themselves one
 * (GitHub matches "skills" too); forks and archived repositories are left out.
 * Private repositories are added by address, not found here.
 */
export const searchGithubRepos = async (
  query: string,
  { limit = 6, signal }: { limit?: number; signal?: AbortSignal } = {},
): Promise<GithubRepoHit[]> => {
  const q = `${query.trim()} skill fork:false archived:false`;
  const response = await fetch(
    `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=${limit}`,
    { headers: { Accept: 'application/vnd.github+json' }, signal },
  );
  if (
    response.status === 429 ||
    (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')
  )
    throw new GithubSearchLimitError();
  if (!response.ok) throw new Error(`GitHub search failed: ${response.status}`);
  const data = (await response.json()) as SearchResponse;
  return (data.items ?? []).map((item) => ({
    avatar: item.owner?.avatar_url ?? '',
    description: item.description,
    fullName: item.full_name,
    stars: item.stargazers_count,
    url: item.html_url,
  }));
};
