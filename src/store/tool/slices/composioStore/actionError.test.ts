/**
 * @vitest-environment happy-dom
 *
 * A failed connect / re-authorize / remove keeps its reason on the row
 * (`composioServerErrors`), so the settings list can explain it in place
 * instead of a toast that is gone by the time the OAuth popup closes.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';

import { useToolStore } from '../../store';
import { initialComposioStoreState } from './initialState';
import { composioServersResource } from './projection';
import { composioStoreSelectors } from './selectors';

const mocks = vi.hoisted(() => ({
  refreshConnectorManagePolicy: vi.fn(),
  createConnection: vi.fn(),
  deleteConnection: vi.fn(),
  getComposioPlugins: vi.fn(),
  getConnection: vi.fn(),
  listActions: vi.fn(),
  updateComposioPlugin: vi.fn(),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    composio: {
      createConnection: { mutate: mocks.createConnection },
      deleteConnection: { mutate: mocks.deleteConnection },
      getComposioPlugins: { query: mocks.getComposioPlugins },
      getConnection: { query: mocks.getConnection },
      updateComposioPlugin: { mutate: mocks.updateComposioPlugin },
    },
  },
  toolsClient: { composio: { listActions: { query: mocks.listActions } } },
}));

vi.mock('@/services/connectorManagePolicy', () => ({
  refreshConnectorManagePolicy: mocks.refreshConnectorManagePolicy,
}));

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

const forbidden = () =>
  Object.assign(new Error('Only the creator or a workspace owner can modify this connector'), {
    data: { code: 'FORBIDDEN', httpStatus: 403 },
  });

const gmailPlugin = (status = 'PENDING') => ({
  customParams: {
    composio: {
      appSlug: 'GMAIL',
      authConfigId: 'ac_gmail',
      connectedAccountId: 'ca_gmail',
      status,
    },
  },
  identifier: 'gmail',
  manifest: { api: [] },
});

const SERVERS_STORAGE_KEY = composioServersResource.storageKey({} as Record<string, never>);
const errorOf = (identifier: string) =>
  composioStoreSelectors.getServerError(identifier)(useToolStore.getState());

describe('composio connection errors', () => {
  let scope = '';

  beforeEach(() => {
    scope = `composio-error-${randomUUID()}:ws`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => useToolStore.setState(initialComposioStoreState));
  });

  afterEach(async () => {
    cleanup();
    await composioServersResource.storage!.remove({ queryKey: SERVERS_STORAGE_KEY, scope });
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  const loadGmail = async (status?: string) => {
    mocks.getComposioPlugins.mockResolvedValue([gmailPlugin(status)]);
    renderHook(() => useToolStore((s) => s.useFetchUserComposioConnections)(true), { wrapper });
    await waitFor(() => expect(useToolStore.getState().composioServers).toHaveLength(1));
  };

  it('keeps a failed connect on the row instead of swallowing it', async () => {
    mocks.createConnection.mockRejectedValue(new TypeError('Failed to fetch'));

    await act(async () => {
      await useToolStore
        .getState()
        .createComposioConnection({ appSlug: 'GMAIL', identifier: 'gmail', label: 'Gmail' });
    });

    expect(errorOf('gmail')).toMatchObject({ action: 'connect', code: 'NETWORK' });
    expect(mocks.refreshConnectorManagePolicy).not.toHaveBeenCalled();
  });

  it('turns a permission rejection into a policy refetch, not a red reason', async () => {
    // The button only looked usable because the cached policy was stale; the
    // refetched policy disables the row with its hover reason instead.
    mocks.createConnection.mockRejectedValue(forbidden());

    await act(async () => {
      await useToolStore
        .getState()
        .createComposioConnection({ appSlug: 'GMAIL', identifier: 'gmail', label: 'Gmail' });
    });

    expect(errorOf('gmail')).toBeUndefined();
    expect(mocks.refreshConnectorManagePolicy).toHaveBeenCalledTimes(1);
  });

  it('does not show one scope’s failure on the same row of another scope', async () => {
    mocks.createConnection.mockRejectedValue(new TypeError('Failed to fetch'));

    await act(async () => {
      await useToolStore
        .getState()
        .createComposioConnection({ appSlug: 'GMAIL', identifier: 'gmail', label: 'Gmail' });
    });
    expect(errorOf('gmail')).toBeDefined();

    const workspaceScope = scope;
    scope = `composio-error-${randomUUID()}:personal`;
    expect(errorOf('gmail')).toBeUndefined();

    scope = workspaceScope;
    expect(errorOf('gmail')).toMatchObject({ code: 'NETWORK' });
  });

  it('clears the previous failure when a new connect starts and succeeds', async () => {
    act(() => useToolStore.getState().setComposioServerError('gmail', { action: 'connect' }));
    mocks.createConnection.mockResolvedValue({
      authConfigId: 'ac_gmail',
      connectedAccountId: 'ca_gmail',
      identifier: 'gmail',
      redirectUrl: 'https://composio.dev/redirect',
    });

    await act(async () => {
      await useToolStore
        .getState()
        .createComposioConnection({ appSlug: 'GMAIL', identifier: 'gmail', label: 'Gmail' });
    });

    expect(errorOf('gmail')).toBeUndefined();
  });

  it('stops re-authorizing when the cleanup is rejected for permission', async () => {
    await loadGmail();
    mocks.deleteConnection.mockRejectedValue(forbidden());

    await act(async () => {
      await useToolStore.getState().reauthorizeComposioConnection('gmail');
    });

    expect(mocks.createConnection).not.toHaveBeenCalled();
    expect(errorOf('gmail')).toBeUndefined();
    expect(mocks.refreshConnectorManagePolicy).toHaveBeenCalledTimes(1);
  });

  it('puts the row back without a red reason when the delete is rejected for permission', async () => {
    await loadGmail('ACTIVE');
    mocks.deleteConnection.mockRejectedValue(forbidden());

    await act(async () => {
      await useToolStore.getState().removeComposioConnection('gmail');
    });

    expect(useToolStore.getState().composioServers.map((s) => s.identifier)).toEqual(['gmail']);
    expect(errorOf('gmail')).toBeUndefined();
    expect(mocks.refreshConnectorManagePolicy).toHaveBeenCalledTimes(1);
  });

  it('puts the row back with the reason when the delete is rejected', async () => {
    await loadGmail('ACTIVE');
    mocks.deleteConnection.mockRejectedValue(new TypeError('Failed to fetch'));

    await act(async () => {
      await useToolStore.getState().removeComposioConnection('gmail');
    });

    expect(useToolStore.getState().composioServers.map((s) => s.identifier)).toEqual(['gmail']);
    expect(errorOf('gmail')).toMatchObject({ action: 'remove', code: 'NETWORK' });
  });

  it('removes the row without an error when the delete succeeds', async () => {
    await loadGmail('ACTIVE');
    mocks.deleteConnection.mockResolvedValue({ success: true });

    await act(async () => {
      await useToolStore.getState().removeComposioConnection('gmail');
    });

    expect(useToolStore.getState().composioServers).toEqual([]);
    expect(errorOf('gmail')).toBeUndefined();
  });

  it('drops a connection removed elsewhere (detail-panel uninstall) from the list', async () => {
    await loadGmail('ACTIVE');
    act(() => useToolStore.getState().setComposioServerError('gmail', { action: 'connect' }));

    act(() => useToolStore.getState().forgetComposioConnection('gmail'));

    expect(useToolStore.getState().composioServers).toEqual([]);
    expect(errorOf('gmail')).toBeUndefined();
    expect(mocks.deleteConnection).not.toHaveBeenCalled();
  });
});
