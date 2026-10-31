import { SdkErrorCode, SdkHttpError } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MCPClient } from './client';

const connect = vi.hoisted(() => vi.fn());
vi.mock('@modelcontextprotocol/client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Client: class {
    connect = connect;
  },
}));

const httpError = (status: number, message: string) =>
  new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, message, { status });

beforeEach(() => connect.mockReset());

describe('HTTP MCP authorization errors', () => {
  it('preserves a 401 challenge even when the SDK error message does not contain the status', async () => {
    connect.mockRejectedValueOnce(
      httpError(401, 'Error POSTing to endpoint: {"error":"invalid_token"}'),
    );
    const client = new MCPClient({
      name: 'oauth-mcp',
      type: 'http',
      url: 'https://oauth.example/mcp',
    });
    await expect(client.initialize()).rejects.toMatchObject({
      data: { type: 'AUTHORIZATION_ERROR' },
    });
  });
  it('leaves unrelated HTTP errors unchanged', async () => {
    const error = httpError(503, 'Service unavailable');
    connect.mockRejectedValueOnce(error);
    const client = new MCPClient({
      name: 'oauth-mcp',
      type: 'http',
      url: 'https://oauth.example/mcp',
    });
    await expect(client.initialize()).rejects.toBe(error);
  });

  it('does not mistake digits in an endpoint or message for an HTTP authorization status', async () => {
    const error = httpError(404, 'Service not found at localhost:4010, HTTP 401 expected');
    connect.mockRejectedValueOnce(error);
    const client = new MCPClient({
      name: 'oauth-mcp',
      type: 'http',
      url: 'http://localhost:4010/mcp',
    });
    await expect(client.initialize()).rejects.toBe(error);
  });
});
