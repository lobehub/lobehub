// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { connectorRouter } from './index';

const result = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/connector/stateStore', async (original) => ({
  ...(await original<object>()),
  readConnectorOAuthCompletion: result,
}));
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) => opts.next({ ctx: opts.ctx }),
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => ({}) },
}));
const caller = (userId = 'me', workspaceId?: string) =>
  connectorRouter.createCaller({ userId, workspaceId, serverDB: {} } as never);
afterEach(() => {
  vi.clearAllMocks();
});
describe('OAuth completion receipts', () => {
  it('returns only the exact outcome to the initiating user and scope', async () => {
    result.mockResolvedValue({
      lobeUserId: 'me',
      workspaceId: 'ws',
      connectorId: 'c',
      linkId: 'lnk_b',
      outcome: 'matchedExisting',
    });
    expect(await caller('me', 'ws').oauthResult({ flowId: 'state' })).toEqual({
      linkId: 'lnk_b',
      outcome: 'matchedExisting',
    });
    await expect(caller('other', 'ws').oauthResult({ flowId: 'state' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(caller('me').oauthResult({ flowId: 'state' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('does not reveal expired or missing receipts', async () => {
    result.mockResolvedValue(null);
    await expect(caller().oauthResult({ flowId: 'expired' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
