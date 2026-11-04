import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MCPClient } from './client';

const { listTools } = vi.hoisted(() => ({ listTools: vi.fn() }));

vi.mock('@modelcontextprotocol/client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Client: class {
    getProtocolEra = () => 'legacy';
    listTools = listTools;
  },
}));

const params = { name: 'local', type: 'http' as const, url: 'http://127.0.0.1:3000/mcp' };

beforeEach(() => {
  listTools.mockReset();
});

describe('desktop MCPClient.isToolCallableByApp', () => {
  it('refuses tools whose visibility leaves out the app, and allows the default', async () => {
    listTools.mockResolvedValue({
      tools: [
        { _meta: { ui: { visibility: ['model'] } }, name: 'delete_all' },
        { _meta: { ui: { visibility: ['app'] } }, name: 'refresh' },
        { name: 'search' },
      ],
    });
    const client = new MCPClient(params);

    await expect(client.isToolCallableByApp('delete_all')).resolves.toBe(false);
    await expect(client.isToolCallableByApp('refresh')).resolves.toBe(true);
    await expect(client.isToolCallableByApp('search')).resolves.toBe(true);
    expect(listTools).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed listing, which the controller treats as refused', async () => {
    listTools.mockRejectedValue(new Error('offline'));
    const client = new MCPClient(params);

    await expect(client.isToolCallableByApp('search')).rejects.toThrow('offline');
  });
});
