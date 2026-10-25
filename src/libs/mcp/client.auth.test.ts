import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MCPClient } from './client';

const connect = vi.hoisted(() => vi.fn());
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = connect;
  },
}));

beforeEach(() => connect.mockReset());

describe('HTTP MCP authorization errors', () => {
  it('preserves a 401 challenge even when the SDK error message does not contain the status', async () => {
    connect.mockRejectedValueOnce(
      Object.assign(
        new Error('Streamable HTTP error: Error POSTing to endpoint: {"error":"invalid_token"}'),
        { code: 401 },
      ),
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
    const error = Object.assign(new Error('Service unavailable'), { code: 503 });
    connect.mockRejectedValueOnce(error);
    const client = new MCPClient({
      name: 'oauth-mcp',
      type: 'http',
      url: 'https://oauth.example/mcp',
    });
    await expect(client.initialize()).rejects.toBe(error);
  });

  it('does not mistake digits in an endpoint or message for an HTTP authorization status', async () => {
    const error = Object.assign(new Error('Service not found at localhost:4010'), { code: 404 });
    connect.mockRejectedValueOnce(error);
    const client = new MCPClient({
      name: 'oauth-mcp',
      type: 'http',
      url: 'http://localhost:4010/mcp',
    });
    await expect(client.initialize()).rejects.toBe(error);
  });
});
