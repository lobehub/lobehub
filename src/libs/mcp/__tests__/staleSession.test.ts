import { describe, expect, it, vi } from 'vitest';

import { MCPClient } from '../index';

const clientWith = (listTools: () => Promise<unknown>, protocolEra = 'legacy') => {
  const client = new MCPClient({ name: 'stale', type: 'http', url: 'http://127.0.0.1:1/mcp' });
  (client as unknown as { mcp: unknown }).mcp = { getProtocolEra: () => protocolEra, listTools };
  return client;
};

describe('MCPClient.listTools stale sessions', () => {
  it('asks for a new session when the server no longer knows the session id', async () => {
    const error = Object.assign(
      new Error(
        'Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","id":"server-error","error":{"code":-32600,"message":"Session not found"}}',
      ),
      { code: 404 },
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(clientWith(() => Promise.reject(error)).listTools()).rejects.toThrow(
      'NoValidSessionId',
    );
  });

  it('keeps the TypeScript SDK message on the same path', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      clientWith(() =>
        Promise.reject(new Error('Bad Request: No valid session ID provided')),
      ).listTools(),
    ).rejects.toThrow('NoValidSessionId');
  });

  it('does not treat a modern protocol error as an expired legacy session', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      clientWith(() => Promise.reject(new Error('Session not found')), 'modern').listTools(),
    ).resolves.toEqual([]);
  });

  it('still returns no tools for unrelated errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      clientWith(() => Promise.reject(new Error('fetch failed'))).listTools(),
    ).resolves.toEqual([]);
  });
});
