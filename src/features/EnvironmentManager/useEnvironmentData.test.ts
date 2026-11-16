/**
 * @vitest-environment happy-dom
 *
 * The environments page's list hook paints the last list from the sandbox
 * environments replica on a reload, while the network confirms it. A restored
 * empty list is not an answer: it stays unsettled until the server says.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { environmentService } from '@/services/environment';
import { initialState } from '@/store/sandbox/initialState';
import { sandboxEnvironmentsResource } from '@/store/sandbox/projection';
import { useSandboxStore } from '@/store/sandbox/store';

import { useEnvironments } from './useEnvironmentData';

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};
const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    createElement(MutateBridge),
    children,
  );

type Listed = Awaited<ReturnType<typeof environmentService.listEnvironments>>;

const storedRow = {
  createdAt: '2026-10-01T00:00:00.000Z',
  creator: { avatar: null, fullName: 'Ada', id: 'user-1', username: 'ada' },
  description: 'Main repo',
  id: 'env-1',
  kind: 'code',
  name: 'Lobehub Dev',
  repository: 'lobehub/lobehub',
  userId: 'user-1',
  visibility: 'private',
  workspaceId: 'ws-1',
};

describe('useEnvironments', () => {
  let scope = '';
  let answer: (value: Listed) => void;

  beforeEach(() => {
    scope = `env-page-${randomUUID()}:ws-1`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    useSandboxStore.setState({ ...initialState });
    // Held until the test answers it: what the hook has first can only come from storage.
    vi.spyOn(environmentService, 'listEnvironments').mockImplementation(
      () => new Promise<Listed>((resolve) => (answer = resolve)),
    );
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      ['all', 'public', 'private'].map((queryKey) =>
        sandboxEnvironmentsResource.storage!.remove({ queryKey, scope }),
      ),
    );
    vi.restoreAllMocks();
  });

  const seed = (data: unknown[]) =>
    sandboxEnvironmentsResource.storage!.set(
      { queryKey: 'private', scope },
      { data: data as never, updatedAt: 1 },
    );

  it('has the stored list on a reload before the network answers, then the server answer', async () => {
    await seed([storedRow]);

    const { result } = renderHook(() => useEnvironments('private'), { wrapper });

    await waitFor(() =>
      expect(result.current).toMatchObject({
        environments: [expect.objectContaining({ name: 'Lobehub Dev' })],
        settled: true,
      }),
    );

    await act(async () =>
      answer({
        environments: [
          {
            ...storedRow,
            configuration: { sources: [] },
            createdAt: new Date(storedRow.createdAt),
            name: 'Lobehub Renamed',
            updatedAt: new Date(storedRow.createdAt),
          },
        ],
      } as unknown as Listed),
    );

    await waitFor(() =>
      expect(result.current.environments?.map(({ name }) => name)).toEqual(['Lobehub Renamed']),
    );
  });

  it('keeps an empty stored list unsettled until the server confirms it', async () => {
    await seed([]);

    const { result } = renderHook(() => useEnvironments('private'), { wrapper });

    await waitFor(() => expect(result.current).toMatchObject({ environments: [] }));
    expect(result.current.settled).toBe(false);

    await act(async () => answer({ environments: [] } as unknown as Listed));

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.environments).toEqual([]);
  });
});
