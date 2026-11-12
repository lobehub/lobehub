/**
 * @vitest-environment happy-dom
 *
 * The environments page paints the last list from the sandbox environments
 * replica on a reload, while the network confirms it. A restored empty list
 * is not an answer: it keeps the skeleton until the server says.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { createElement, type PropsWithChildren, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { environmentService } from '@/services/environment';
import { initialState } from '@/store/sandbox/initialState';
import { sandboxEnvironmentsResource } from '@/store/sandbox/projection';
import { useSandboxStore } from '@/store/sandbox/store';

import EnvironmentManager from './index';

// The app extends dayjs at boot; rows render "created … ago".
dayjs.extend(relativeTime);

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};
const Wrapper = ({ children }: PropsWithChildren) =>
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

describe('EnvironmentManager', () => {
  let scope = '';
  let answer: (value: Listed) => void;

  beforeEach(() => {
    scope = `env-page-${randomUUID()}:ws-1`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    vi.spyOn(cacheScope, 'canHydrate').mockReturnValue(true);
    useSandboxStore.setState({ ...initialState });
    // Held until the test answers it: what paints first can only come from storage.
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

  it('paints the stored list on a reload before the network answers, then the server answer', async () => {
    await seed([storedRow]);

    render(<EnvironmentManager visibility={'private'} />, { wrapper: Wrapper });

    expect(await screen.findByText('Lobehub Dev')).toBeTruthy();
    expect(screen.getByText('lobehub/lobehub')).toBeTruthy();

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

    await waitFor(() => expect(screen.getByText('Lobehub Renamed')).toBeTruthy());
    expect(screen.queryByText('Lobehub Dev')).toBeNull();
  });

  it('keeps the skeleton over an empty stored list until the server confirms it', async () => {
    await seed([]);

    render(<EnvironmentManager visibility={'private'} />, { wrapper: Wrapper });

    await waitFor(() =>
      expect(useSandboxStore.getState().sandboxEnvironmentsMap.private).toEqual([]),
    );
    expect(screen.queryByText('environments.empty')).toBeNull();

    await act(async () => answer({ environments: [] } as unknown as Listed));

    expect(await screen.findByText('environments.empty')).toBeTruthy();
  });
});
