import type * as BusinessConst from '@lobechat/business-const';
import {
  Client,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  UnauthorizedError,
} from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MCPClient } from './client';

const httpClient = () =>
  new MCPClient({ name: 'test', type: 'http', url: 'https://mcp.example.com' });
const httpError = (status: number) =>
  new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'Error POSTing to endpoint', { status });
afterEach(() => vi.restoreAllMocks());

describe('MCP SDK v2 error handling', () => {
  it.each([httpError(403), new UnauthorizedError()])(
    'classifies negotiation authorization failures: %s',
    async (error) => {
      vi.spyOn(Client.prototype, 'connect').mockRejectedValue(error);
      await expect(httpClient().initialize()).rejects.toMatchObject({
        data: { type: 'AUTHORIZATION_ERROR' },
      });
    },
  );

  it.each([
    [new SdkError(SdkErrorCode.RequestTimeout, 'probe timed out'), 'INITIALIZATION_TIMEOUT'],
    [
      new SdkHttpError(SdkErrorCode.EraNegotiationFailed, 'probe HTTP 503', { status: 503 }),
      'CONNECTION_FAILED',
    ],
  ])('classifies failed discovery: %s', async (error, type) => {
    vi.spyOn(Client.prototype, 'connect').mockRejectedValue(error);
    await expect(httpClient().initialize()).rejects.toMatchObject({ data: { type } });
  });

  it('never retries a modern HTTP 404 as a stale session', async () => {
    vi.spyOn(Client.prototype, 'getProtocolEra').mockReturnValue('modern');
    vi.spyOn(Client.prototype, 'callTool').mockRejectedValue(httpError(404));
    await expect(httpClient().callTool('test', {})).rejects.toMatchObject({ status: 404 });
  });

  it('reports a legacy HTTP 404 on a resource read as a stale session', async () => {
    vi.spyOn(Client.prototype, 'getProtocolEra').mockReturnValue('legacy');
    vi.spyOn(Client.prototype, 'readResource').mockRejectedValue(httpError(404));
    await expect(httpClient().readResource('ui://app')).rejects.toThrow('NoValidSessionId');
  });

  it('passes a modern HTTP 404 on a resource read through unchanged', async () => {
    vi.spyOn(Client.prototype, 'getProtocolEra').mockReturnValue('modern');
    vi.spyOn(Client.prototype, 'readResource').mockRejectedValue(httpError(404));
    await expect(httpClient().readResource('ui://app')).rejects.toMatchObject({ status: 404 });
  });

  it('returns a completed tool failure for unsupported input_required', async () => {
    vi.spyOn(Client.prototype, 'callTool').mockRejectedValue(
      new SdkError(SdkErrorCode.UnsupportedResultType, 'input_required', {
        resultType: 'input_required',
        method: 'tools/call',
      }),
    );
    await expect(httpClient().callTool('test', {})).resolves.toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'This MCP tool requires user input that LobeHub does not support yet. Use a tool that does not require additional input.',
        },
      ],
    });
  });

  it("names the deployment's own app in the input_required failure under custom branding", async () => {
    vi.resetModules();
    vi.doMock('@lobechat/business-const', async (importOriginal) => ({
      ...(await importOriginal<typeof BusinessConst>()),
      BRANDING_NAME: 'Acme',
    }));
    // Under vitest 5 a `doMock` only lands once the test file itself imports
    // something, so pull the mocked module in before the one under test.
    await import('@lobechat/business-const');
    const sdk = await import('@modelcontextprotocol/client');
    const { MCPClient: BrandedClient } = await import('./client');
    vi.spyOn(sdk.Client.prototype, 'callTool').mockRejectedValue(
      new sdk.SdkError(sdk.SdkErrorCode.UnsupportedResultType, 'input_required', {
        resultType: 'input_required',
        method: 'tools/call',
      }),
    );

    const result = await new BrandedClient({
      name: 'test',
      type: 'http',
      url: 'https://mcp.example.com',
    }).callTool('test', {});

    expect(result.content[0].text).toContain('user input that Acme does not support yet');
    vi.doUnmock('@lobechat/business-const');
    vi.resetModules();
  });

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
