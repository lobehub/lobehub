import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { lambdaClient } from '@/libs/trpc/client';
import { ConnectorOAuthError, waitForConnectorOAuth } from '@/utils/connectorOAuth';

import { useToolStore } from '../../store';
import { initialConnectorState } from './initialState';
import { isConnectorLinkNameConflict, supportsMultipleConnectorAccounts } from './types';

const mocks = vi.hoisted(() => ({ wait: vi.fn() }));
vi.mock('@/utils/connectorOAuth', async (original) => ({
  ...(await original<object>()),
  waitForConnectorOAuth: mocks.wait,
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    connector: {
      list: { query: vi.fn() },
      listAgentBound: { query: vi.fn() },
      listByAgent: { query: vi.fn() },
      oauthResult: { query: vi.fn() },
      startOAuth: {
        mutate: vi.fn().mockResolvedValue({ authorizationUrl: 'https://provider/authorize' }),
      },
      renameLink: { mutate: vi.fn() },
      deleteLink: { mutate: vi.fn() },
    },
  },
}));
const connector = (ids: string[]) =>
  ({ id: 'c1', identifier: 'test', links: ids.map((id) => ({ id, name: id })), tools: [] }) as any;
beforeEach(() => {
  vi.spyOn(cacheScope, 'get').mockReturnValue('accounts-test:personal');
  useToolStore.setState({ ...initialConnectorState });
  vi.mocked(lambdaClient.connector.list.query).mockResolvedValue([connector(['old'])]);
  mocks.wait.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
describe('connector account store actions', () => {
  it('refetches account summaries after add, detects deduplication and requests a fresh desktop session', async () => {
    await useToolStore.getState().fetchConnectors();
    vi.mocked(lambdaClient.connector.list.query).mockResolvedValue([connector(['old', 'new'])]);
    const popup = { close: vi.fn() } as unknown as Window;
    expect(await useToolStore.getState().connectConnectorAccount('c1', { popup })).toEqual({
      outcome: 'created',
      linkId: 'new',
    });
    expect(waitForConnectorOAuth).toHaveBeenLastCalledWith(
      popup,
      'c1',
      'https://provider/authorize',
      undefined,
      true,
    );
    expect(popup.close).toHaveBeenCalled();
    expect(await useToolStore.getState().connectConnectorAccount('c1')).toMatchObject({
      outcome: 'matchedExisting',
    });
    expect(useToolStore.getState().connectors[0].links).toHaveLength(2);
  });
  it('reauthorizes a specific account, refreshes after rename/remove and preserves conflict errors', async () => {
    await useToolStore.getState().fetchConnectors();
    expect(await useToolStore.getState().reauthorizeConnectorAccount('c1', 'old')).toMatchObject({
      outcome: 'reauthorized',
      linkId: 'old',
    });
    expect(lambdaClient.connector.startOAuth.mutate).toHaveBeenLastCalledWith(
      {
        id: 'c1',
        link: { mode: 'reauthorize', linkId: 'old' },
      },
      { signal: undefined },
    );
    const error = { data: { code: 'CONFLICT' } };
    vi.mocked(lambdaClient.connector.renameLink.mutate).mockRejectedValueOnce(error);
    await expect(
      useToolStore.getState().renameConnectorAccount('c1', 'old', 'Duplicate'),
    ).rejects.toBe(error);
    expect(isConnectorLinkNameConflict(error)).toBe(true);
    vi.mocked(lambdaClient.connector.list.query).mockResolvedValue([connector([])]);
    await useToolStore.getState().removeConnectorAccount('c1', 'old');
    expect(useToolStore.getState().connectors[0].links).toEqual([]);
  });
  it('keeps user dismissal reason and closes the popup', async () => {
    const popup = { close: vi.fn() } as unknown as Window;
    mocks.wait.mockRejectedValueOnce(new ConnectorOAuthError('dismissed'));
    await expect(
      useToolStore.getState().connectConnectorAccount('c1', { popup }),
    ).rejects.toMatchObject({ reason: 'dismissed' });
    expect(popup.close).toHaveBeenCalled();
  });
  it('passes a server rejection through with its reason and closes the popup', async () => {
    const popup = { close: vi.fn() } as unknown as Window;
    const rejection = Object.assign(new Error('OAuth server rejected the registration'), {
      data: { code: 'BAD_REQUEST', httpStatus: 400 },
    });
    vi.mocked(lambdaClient.connector.startOAuth.mutate).mockRejectedValueOnce(rejection);
    await expect(useToolStore.getState().connectConnectorAccount('c1', { popup })).rejects.toBe(
      rejection,
    );
    expect(popup.close).toHaveBeenCalled();
  });
  it('limits multiple accounts to custom HTTP OAuth connectors', () => {
    expect(
      supportsMultipleConnectorAccounts({
        authKind: 'oauth2',
        sourceType: 'custom',
        mcpConnectionType: 'http',
      }),
    ).toBe(true);
    expect(
      supportsMultipleConnectorAccounts({
        authKind: 'bearer',
        sourceType: 'custom',
        mcpConnectionType: 'http',
      }),
    ).toBe(false);
  });
  it('reads the exact server outcome after native completion instead of guessing from the target', async () => {
    vi.mocked(lambdaClient.connector.startOAuth.mutate).mockResolvedValueOnce({
      authorizationUrl: 'https://provider/authorize',
      flowId: 'flow',
    });
    vi.mocked(lambdaClient.connector.oauthResult.query).mockResolvedValueOnce({
      linkId: 'other-existing',
      outcome: 'matchedExisting',
    });
    expect(await useToolStore.getState().reauthorizeConnectorAccount('c1', 'old')).toEqual({
      linkId: 'other-existing',
      outcome: 'matchedExisting',
    });
  });
  it('treats a pre-aborted flow as dismissal before starting OAuth', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      useToolStore.getState().connectConnectorAccount('c1', { signal: abort.signal }),
    ).rejects.toMatchObject({ reason: 'dismissed' });
    expect(lambdaClient.connector.startOAuth.mutate).not.toHaveBeenCalled();
  });
});
