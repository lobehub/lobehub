// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { ChannelHistoryService, resolveConnectorRequest } from './ChannelHistoryService';

const mocks = vi.hoisted(() => ({ notifyChannel: vi.fn(), postConnectorRequest: vi.fn() }));

vi.mock('@/database/repositories/channel', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ChannelHistoryRepository: vi.fn(function () {
    return { postConnectorRequest: mocks.postConnectorRequest };
  }),
}));
vi.mock('./featureGate', () => ({ assertChannelEnabled: vi.fn() }));
vi.mock('./notify', () => ({ notifyChannel: mocks.notifyChannel }));

vi.mock('@/config/composio', () => ({ composioEnv: { COMPOSIO_API_KEY: 'key' } }));
vi.mock('@/envs/app', () => ({
  appEnv: { MARKET_TRUSTED_CLIENT_ID: 'id', MARKET_TRUSTED_CLIENT_SECRET: 'secret' },
}));

describe('resolveConnectorRequest', () => {
  it('takes the label of the catalog that owns the identifier', () => {
    expect(resolveConnectorRequest({ identifier: 'github', reason: ' to read PRs ' })).toEqual({
      auth: null,
      identifier: 'github',
      name: 'GitHub',
      reason: 'to read PRs',
      source: 'lobehub',
      url: null,
    });
  });

  it('resolves an official MCP server without a url', () => {
    expect(resolveConnectorRequest({ identifier: 'sentry' })).toMatchObject({
      name: 'Sentry',
      source: 'official',
      url: null,
    });
  });

  it('asks for a url outside the catalogs', () => {
    expect(() => resolveConnectorRequest({ identifier: 'acme-docs' })).toThrow(/url/);
  });

  it('keeps a custom https server, defaulting to oauth', () => {
    expect(
      resolveConnectorRequest({
        identifier: 'acme-docs',
        name: 'Acme Docs',
        url: 'https://mcp.acme.dev/mcp',
      }),
    ).toEqual({
      auth: 'oauth',
      identifier: 'acme-docs',
      name: 'Acme Docs',
      reason: null,
      source: 'custom',
      url: 'https://mcp.acme.dev/mcp',
    });
  });

  it('rejects a plain-http server, credentials in the url and odd identifiers', () => {
    expect(() =>
      resolveConnectorRequest({ identifier: 'x', url: 'http://mcp.example.com/mcp' }),
    ).toThrow(/https/);
    expect(() =>
      resolveConnectorRequest({ identifier: 'x', url: 'https://a:b@mcp.example.com/mcp' }),
    ).toThrow(/credentials/);
    expect(() => resolveConnectorRequest({ identifier: 'a b' })).toThrow(/identifier/);
  });
});

describe('resolveConnectorRequest catalog servers', () => {
  it('connects a server already in the official catalog by its identifier alone', () => {
    expect(resolveConnectorRequest({ identifier: 'context7' })).toMatchObject({
      source: 'official',
    });
  });
});

describe('ChannelHistoryService.requestConnector', () => {
  it('posts one card per run and call, then refreshes the conversation', async () => {
    mocks.postConnectorRequest.mockResolvedValue({ channelId: 'chn_1', id: 'msg_1' });
    const service = new ChannelHistoryService({} as never, 'usr_1', 'op_1');

    await expect(service.requestConnector({ identifier: 'github' }, 'call_1')).resolves.toEqual({
      messageId: 'msg_1',
      name: 'GitHub',
      source: 'lobehub',
    });
    expect(mocks.postConnectorRequest).toHaveBeenCalledWith(
      'op_1',
      expect.objectContaining({ identifier: 'github', source: 'lobehub' }),
      'connector:op_1:call_1',
    );
    expect(mocks.notifyChannel).toHaveBeenCalledWith({}, 'chn_1');
  });
});
