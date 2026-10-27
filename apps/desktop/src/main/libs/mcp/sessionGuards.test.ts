import { ProtocolError, SdkError, SdkErrorCode, SdkHttpError } from '@modelcontextprotocol/client';
import { describe, expect, it, vi } from 'vitest';

import { MCPClient } from './client';
import { isDeadTransportError, isStaleSessionError } from './sessionGuards';

describe('SDK session guards', () => {
  it.each([SdkErrorCode.ConnectionClosed, SdkErrorCode.NotConnected])(
    'evicts SDK %s without authorizing a replay',
    (code) => {
      const error = new SdkError(code, 'transport unavailable');
      expect(isDeadTransportError(error)).toBe(true);
      expect(isStaleSessionError(error)).toBe(false);
    },
  );
  it('retries HTTP 404 once through the stale-session path', () => {
    expect(
      isStaleSessionError(
        new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'Session not found', {
          status: 404,
        }),
      ),
    ).toBe(true);
  });
  it.each([
    new Error('Connection closed by tool sandbox'),
    new Error('Connection closed'),
    new ProtocolError(-32000, 'Connection closed'),
  ])('keeps application errors in the pool: %s', (error) => {
    expect(isDeadTransportError(error)).toBe(false);
    expect(isStaleSessionError(error)).toBe(false);
  });
  it('closes the SDK client on disconnect', async () => {
    const close = vi.fn();
    const instance = Object.assign(Object.create(MCPClient.prototype), { mcp: { close } });
    await instance.disconnect();
    expect(close).toHaveBeenCalledOnce();
  });
  it('does not hide application errors mentioning Method not found', async () => {
    const instance = Object.assign(Object.create(MCPClient.prototype), {
      mcp: {
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        listResources: vi.fn().mockResolvedValue({ resources: [] }),
        getServerVersion: vi.fn(),
        listPrompts: vi.fn().mockRejectedValue(new Error('Method not found in sandbox')),
      },
    });
    await expect(instance.listManifests()).rejects.toThrow('Method not found in sandbox');
  });

  it('ignores prompts reported as an unsupported protocol method', async () => {
    const instance = Object.assign(Object.create(MCPClient.prototype), {
      mcp: {
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        listResources: vi.fn().mockResolvedValue({ resources: [] }),
        getServerVersion: vi.fn(),
        listPrompts: vi.fn().mockRejectedValue(new ProtocolError(-32601, 'unsupported')),
      },
    });
    await expect(instance.listManifests()).resolves.toMatchObject({ prompts: undefined });
  });
});
