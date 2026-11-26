import { afterEach, describe, expect, it, vi } from 'vitest';

import { GithubSearchLimitError, searchGithubRepos } from './searchGithubRepos';

const respond = (body: unknown, init?: ResponseInit) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), init));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('searchGithubRepos', () => {
  it('searches skill repositories, without forks or archived ones', async () => {
    const fetch = respond({
      items: [
        {
          description: 'PDF skills',
          full_name: 'o/pdf-skills',
          html_url: 'https://github.com/o/pdf-skills',
          owner: { avatar_url: 'https://avatars/o' },
          stargazers_count: 42,
        },
      ],
    });

    const hits = await searchGithubRepos(' pdf ', { limit: 3 });

    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('https://api.github.com/search/repositories');
    expect(url.searchParams.get('q')).toBe('pdf skill fork:false archived:false');
    expect(url.searchParams.get('per_page')).toBe('3');
    expect(hits).toEqual([
      {
        avatar: 'https://avatars/o',
        description: 'PDF skills',
        fullName: 'o/pdf-skills',
        stars: 42,
        url: 'https://github.com/o/pdf-skills',
      },
    ]);
  });

  it('tells a rate limit apart from other failures', async () => {
    respond({}, { headers: { 'x-ratelimit-remaining': '0' }, status: 403 });
    await expect(searchGithubRepos('pdf')).rejects.toBeInstanceOf(GithubSearchLimitError);

    respond({}, { status: 500 });
    await expect(searchGithubRepos('pdf')).rejects.not.toBeInstanceOf(GithubSearchLimitError);
  });
});
