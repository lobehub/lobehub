import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MCPClient } from './client';

const { clientOptions, listTools, notificationHandlers } = vi.hoisted(() => ({
  clientOptions: [] as unknown[],
  listTools: vi.fn(),
  // The handlers each client registered, by notification method
  notificationHandlers: new Map<string, () => void>(),
}));

vi.mock('@modelcontextprotocol/client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Client: class {
    getProtocolEra = () => 'legacy';
    listTools = listTools;
    setNotificationHandler = (method: string, handler: () => void) =>
      notificationHandlers.set(method, handler);
    constructor(_info: unknown, options?: unknown) {
      clientOptions.push(options);
    }
  },
}));

const params = { name: 'local', type: 'http' as const, url: 'http://127.0.0.1:3000/mcp' };

beforeEach(() => {
  clientOptions.length = 0;
  listTools.mockReset();
});

describe('desktop MCPClient MCP Apps capability', () => {
  it('announces MCP Apps only when asked to', () => {
    new MCPClient(params);
    new MCPClient(params, { mcpApps: true });

    expect(
      clientOptions.map((options) => (options as { capabilities?: unknown }).capabilities),
    ).toEqual([
      undefined,
      {
        extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } },
      },
    ]);
  });
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

describe('desktop MCPClient after the server changes its tools', () => {
  it('lists them again for visibility and views once it says they changed', async () => {
    listTools.mockResolvedValueOnce({
      tools: [{ _meta: { ui: { resourceUri: 'ui://old', visibility: ['app'] } }, name: 'page' }],
    });
    const client = new MCPClient(params, { mcpApps: true });
    await expect(client.isToolCallableByApp('page')).resolves.toBe(true);

    // The server takes the tool from views and moves its view
    listTools.mockResolvedValueOnce({
      tools: [{ _meta: { ui: { resourceUri: 'ui://new', visibility: ['model'] } }, name: 'page' }],
    });
    notificationHandlers.get('notifications/tools/list_changed')?.();

    await expect(client.isToolCallableByApp('page')).resolves.toBe(false);
    await expect(client.getToolUiResourceUri('page')).resolves.toBe('ui://new');
    await expect(client.isToolHiddenFromModel('page')).resolves.toBe(false);
    expect(listTools).toHaveBeenCalledTimes(2);
  });
});

describe('desktop MCPClient when the server cannot list its tools', () => {
  it('gives up at once for a while instead of listing again before every lookup', async () => {
    vi.useFakeTimers();
    try {
      listTools.mockRejectedValue(new Error('slow server'));
      const client = new MCPClient(params, { mcpApps: true });

      await expect(client.isToolHiddenFromModel('page')).rejects.toThrow('slow server');
      await expect(client.getToolUiResourceUri('page')).rejects.toThrow();
      await expect(client.isToolCallableByApp('page')).rejects.toThrow();
      expect(listTools).toHaveBeenCalledTimes(1);

      // Tried again once the cooldown has passed
      listTools.mockResolvedValue({ tools: [{ name: 'page' }] });
      vi.advanceTimersByTime(60_000);
      await expect(client.isToolCallableByApp('page')).resolves.toBe(true);
      expect(listTools).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('desktop MCPClient.isToolCallableByApp for names the listing did not name', () => {
  it('refuses them: only tools the server offered to views run', async () => {
    listTools.mockResolvedValueOnce({ tools: [{ name: 'search' }] });
    const client = new MCPClient(params, { mcpApps: true });

    await expect(client.isToolCallableByApp('search')).resolves.toBe(true);
    await expect(client.isToolCallableByApp('not_listed')).resolves.toBe(false);
  });
});
