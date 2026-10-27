import { Client, SdkError, SdkErrorCode, SdkHttpError } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MCPClient } from './client';

const httpClient = () =>
  new MCPClient({ name: 'test', type: 'http', url: 'https://mcp.example.com' });
const httpError = (status: number) =>
  new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'Error POSTing to endpoint', { status });
afterEach(() => vi.restoreAllMocks());

describe('MCP SDK v2 error handling', () => {
  it('classifies initialize HTTP 401 without a status in the message', async () => {
    vi.spyOn(Client.prototype, 'connect').mockRejectedValue(httpError(401));
    await expect(httpClient().initialize()).rejects.toMatchObject({
      data: { type: 'AUTHORIZATION_ERROR' },
    });
  });

  it.each(['listTools', 'listResources', 'listPrompts', 'callTool'] as const)(
    'maps %s HTTP 404 to an expired session',
    async (method) => {
      vi.spyOn(Client.prototype, method).mockRejectedValue(httpError(404));
      const client = httpClient();
      await expect(
        method === 'callTool' ? client.callTool('test', {}) : client[method](),
      ).rejects.toThrow('NoValidSessionId');
    },
  );

  it('classifies closed stdio connections after a successful command precheck', async () => {
    vi.spyOn(Client.prototype, 'connect').mockRejectedValue(
      new SdkError(SdkErrorCode.ConnectionClosed, 'Connection closed'),
    );
    const client = new MCPClient({
      name: 'test',
      type: 'stdio',
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
    });
    await expect(client.initialize()).rejects.toMatchObject({
      data: { type: 'CONNECTION_FAILED' },
    });
  });

  it('closes the SDK client so pending requests and transport are cleaned up', async () => {
    const close = vi.spyOn(Client.prototype, 'close').mockResolvedValue();
    await httpClient().disconnect();
    expect(close).toHaveBeenCalledOnce();
  });
});
