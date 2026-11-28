import { describe, expect, it, vi } from 'vitest';

import { readMcpUiResource } from '../agents';

const params = {
  clientKinds: ['cli' as const],
  deviceId: 'nas',
  params: { args: ['server.mjs'], command: 'node', name: 'apps', type: 'stdio' as const },
  uri: 'ui://apps/view',
  userId: 'user-1',
  workspaceId: 'ws-1',
};

describe('readMcpUiResource', () => {
  it("reads a view on the device client that runs the server's calls", async () => {
    const resource = { contents: [{ text: '<p>view</p>', uri: 'ui://apps/view' }] };
    const invokeRpc = vi.fn().mockResolvedValue({ data: resource, success: true });

    await expect(readMcpUiResource(() => ({ invokeRpc }) as any, params)).resolves.toEqual(
      resource,
    );
    expect(invokeRpc).toHaveBeenCalledWith(
      {
        clientKinds: ['cli'],
        deviceId: 'nas',
        timeout: 30_000,
        userId: 'user-1',
        workspaceId: 'ws-1',
      },
      { method: 'readMcpUiResource', params: { params: params.params, uri: 'ui://apps/view' } },
    );
  });

  it("fails with the device's reason, and names an outdated client", async () => {
    const failing = vi.fn().mockResolvedValue({ error: 'boom', success: false });
    await expect(readMcpUiResource(() => ({ invokeRpc: failing }) as any, params)).rejects.toThrow(
      'boom',
    );

    const outdated = vi.fn().mockResolvedValue({
      error: 'Unknown device RPC method: readMcpUiResource',
      success: false,
    });
    await expect(readMcpUiResource(() => ({ invokeRpc: outdated }) as any, params)).rejects.toThrow(
      /too old/,
    );
  });

  it('fails without a configured gateway', async () => {
    await expect(readMcpUiResource(() => undefined, params)).rejects.toThrow(/not configured/);
  });
});
