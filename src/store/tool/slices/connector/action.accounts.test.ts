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
  it("takes the callback's own report without needing the server's record", async () => {
    vi.mocked(lambdaClient.connector.startOAuth.mutate).mockResolvedValueOnce({
      authorizationUrl: 'https://provider/authorize',
      flowId: 'flow-1',
    } as never);
    mocks.wait.mockResolvedValueOnce({ linkId: 'old', outcome: 'matchedExisting' });

    expect(await useToolStore.getState().connectConnectorAccount('c1')).toEqual({
      linkId: 'old',
      outcome: 'matchedExisting',
    });
    expect(lambdaClient.connector.oauthResult.query).not.toHaveBeenCalled();
  });

  // The native window reports success alone; its record may not have been written
  it("falls back to the lists when a successful flow's record is missing", async () => {
    await useToolStore.getState().fetchConnectors();
    vi.mocked(lambdaClient.connector.startOAuth.mutate).mockResolvedValueOnce({
      authorizationUrl: 'https://provider/authorize',
      flowId: 'flow-1',
    } as never);
    vi.mocked(lambdaClient.connector.list.query).mockResolvedValue([connector(['old', 'new'])]);
    vi.mocked(lambdaClient.connector.oauthResult.query).mockRejectedValueOnce({
      data: { code: 'NOT_FOUND' },
    });

    expect(await useToolStore.getState().connectConnectorAccount('c1')).toEqual({
      linkId: 'new',
      outcome: 'created',
    });
  });

  // Providers whose COOP policy severs `window.opener` lose the callback's message
  describe('a window that never reports back', () => {
    const startWithFlow = () =>
      vi.mocked(lambdaClient.connector.startOAuth.mutate).mockResolvedValueOnce({
        authorizationUrl: 'https://provider/authorize',
        flowId: 'flow-1',
      } as never);

    it.each(['dismissed', 'timeout'] as const)(
      'takes the account the callback stored when the window is %s',
      async (reason) => {
        await useToolStore.getState().fetchConnectors();
        startWithFlow();
        mocks.wait.mockRejectedValueOnce(new ConnectorOAuthError(reason));
        vi.mocked(lambdaClient.connector.list.query).mockResolvedValue([connector(['old', 'new'])]);
        vi.mocked(lambdaClient.connector.oauthResult.query).mockResolvedValueOnce({
          linkId: 'new',
          outcome: 'created',
        });

        expect(await useToolStore.getState().connectConnectorAccount('c1')).toEqual({
          linkId: 'new',
          outcome: 'created',
        });
        expect(lambdaClient.connector.oauthResult.query).toHaveBeenCalledWith({ flowId: 'flow-1' });
        expect(useToolStore.getState().connectors[0].links).toHaveLength(2);
      },
    );

    it('keeps the dismissal when the callback recorded nothing', async () => {
      startWithFlow();
      mocks.wait.mockRejectedValueOnce(new ConnectorOAuthError('dismissed'));
      vi.mocked(lambdaClient.connector.oauthResult.query).mockRejectedValueOnce({
        data: { code: 'NOT_FOUND' },
      });

      await expect(useToolStore.getState().connectConnectorAccount('c1')).rejects.toMatchObject({
        reason: 'dismissed',
      });
    });

    it('never recovers a flow the user cancelled', async () => {
      const controller = new AbortController();
      startWithFlow();
      mocks.wait.mockImplementationOnce(async () => {
        controller.abort();
        throw new ConnectorOAuthError('dismissed');
      });

      await expect(
        useToolStore.getState().connectConnectorAccount('c1', { signal: controller.signal }),
      ).rejects.toMatchObject({ reason: 'dismissed' });
      expect(lambdaClient.connector.oauthResult.query).not.toHaveBeenCalled();
    });
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
