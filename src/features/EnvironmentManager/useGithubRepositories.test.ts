import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { environmentService } from '@/services/environment';

import { useGithubRepositories } from './useGithubRepositories';

const setup = () => {
  const cache = new Map();
  return renderHook(() => useGithubRepositories(), {
    wrapper: ({ children }: PropsWithChildren) =>
      createElement(
        SWRConfig,
        {
          value: { provider: () => cache, shouldRetryOnError: false, dedupingInterval: 0 },
        },
        children,
      ),
  });
};

afterEach(() => vi.restoreAllMocks());

describe('GitHub repository loading', () => {
  it('reports a rejected request as an error and retries the real SWR fetcher', async () => {
    const fetcher = vi
      .spyOn(environmentService, 'listGithubRepositories')
      .mockRejectedValueOnce(new Error('HTTP 503'))
      .mockResolvedValue({ connected: true, repositories: [] });
    const { result } = setup();
    await waitFor(() => expect(result.current.state).toBe('error'));
    await act(async () => {
      await result.current.retry();
    });
    await waitFor(() => expect(result.current.state).toBe('empty'));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps previous repositories when retry fails and recovers without losing them', async () => {
    const repositories = [{ owner: 'qa', name: 'repo', defaultBranch: 'main', isPrivate: false }];
    const fetcher = vi
      .spyOn(environmentService, 'listGithubRepositories')
      .mockResolvedValueOnce({ connected: true, repositories })
      .mockRejectedValueOnce(new Error('HTTP 503'))
      .mockResolvedValue({ connected: true, repositories });
    const { result } = setup();
    await waitFor(() => expect(result.current.state).toBe('ready'));
    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.state).toBe('error');
    expect(result.current.data?.repositories).toEqual(repositories);
    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.state).toBe('ready');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('does not call a pending request empty', () => {
    vi.spyOn(environmentService, 'listGithubRepositories').mockReturnValue(new Promise(() => {}));
    const { result } = setup();
    expect(result.current.state).toBe('loading');
  });

  it('keeps unavailable authorization distinct from a successful empty list', async () => {
    vi.spyOn(environmentService, 'listGithubRepositories').mockResolvedValue({
      connected: false,
      repositories: [],
    });
    const { result } = setup();
    await waitFor(() => expect(result.current.state).toBe('disconnected'));
  });
});
