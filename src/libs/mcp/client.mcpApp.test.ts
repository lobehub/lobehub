import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MCPClient } from './client';
import { MCP_APPS_CLIENT_CAPABILITIES } from './mcpApp';

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

const params = { name: 'weather', type: 'http' as const, url: 'https://mcp.example.com/mcp' };

beforeEach(() => {
  clientOptions.length = 0;
  listTools.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MCPClient MCP Apps capability', () => {
  it('announces the MCP Apps extension only when asked to', () => {
    new MCPClient(params);
    new MCPClient(params, { mcpApps: false });
    new MCPClient(params, { mcpApps: true });

    expect(
      clientOptions.map((options) => (options as { capabilities?: unknown }).capabilities),
    ).toEqual([undefined, undefined, MCP_APPS_CLIENT_CAPABILITIES]);
  });
});

describe('MCPClient.getToolUiResourceUri', () => {
  it('lists tools once and reads the view from the cached map', async () => {
    listTools.mockResolvedValue({
      tools: [
        { _meta: { ui: { resourceUri: 'ui://weather/view' } }, name: 'forecast' },
        { name: 'search' },
      ],
    });
    const client = new MCPClient(params, { mcpApps: true });

    await expect(client.getToolUiResourceUri('forecast')).resolves.toBe('ui://weather/view');
    await expect(client.getToolUiResourceUri('search')).resolves.toBeUndefined();
    expect(listTools).toHaveBeenCalledTimes(1);
  });

  it('does not list tools again on every call after a failed listing', async () => {
    listTools.mockRejectedValue(new Error('upstream 500'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = new MCPClient(params, { mcpApps: true });

    await expect(client.getToolUiResourceUri('forecast')).resolves.toBeUndefined();
    await expect(client.getToolUiResourceUri('forecast')).resolves.toBeUndefined();
    await expect(client.getToolUiResourceUri('forecast')).resolves.toBeUndefined();

    expect(listTools).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it('lists tools again once the retry window after a failed listing has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    listTools.mockRejectedValueOnce(new Error('upstream 500'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = new MCPClient(params, { mcpApps: true });

    await expect(client.getToolUiResourceUri('forecast')).resolves.toBeUndefined();

    // The transient failure is over, but nothing else on this client lists tools
    listTools.mockResolvedValue({
      tools: [{ _meta: { ui: { resourceUri: 'ui://weather/view' } }, name: 'forecast' }],
    });
    vi.setSystemTime(new Date('2026-01-01T00:00:30Z'));
    await expect(client.getToolUiResourceUri('forecast')).resolves.toBeUndefined();
    expect(listTools).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
    await expect(client.getToolUiResourceUri('forecast')).resolves.toBe('ui://weather/view');
    expect(listTools).toHaveBeenCalledTimes(2);

    // Once a listing succeeded, it is not retried even after the window
    vi.setSystemTime(new Date('2026-01-01T01:00:00Z'));
    await expect(client.getToolUiResourceUri('forecast')).resolves.toBe('ui://weather/view');
    expect(listTools).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it('picks views up again once a later listing succeeds', async () => {
    listTools.mockRejectedValueOnce(new Error('upstream 500'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = new MCPClient(params, { mcpApps: true });
    await client.getToolUiResourceUri('forecast');

    // e.g. a manifest refresh on the same session
    listTools.mockResolvedValue({
      tools: [{ _meta: { ui: { resourceUri: 'ui://weather/view' } }, name: 'forecast' }],
    });
    await client.listTools();

    await expect(client.getToolUiResourceUri('forecast')).resolves.toBe('ui://weather/view');
    consoleError.mockRestore();
  });
});

describe('MCPClient.isToolCallableByApp', () => {
  it('refuses tools whose visibility leaves out the app, and allows the default', async () => {
    listTools.mockResolvedValue({
      tools: [
        { _meta: { ui: { visibility: ['model'] } }, name: 'delete_all' },
        { _meta: { ui: { visibility: ['app'] } }, name: 'refresh' },
        { _meta: { ui: { visibility: ['model', 'app'] } }, name: 'forecast' },
        { name: 'search' },
      ],
    });
    const client = new MCPClient(params, { mcpApps: true });

    await expect(client.isToolCallableByApp('delete_all')).resolves.toBe(false);
    await expect(client.isToolCallableByApp('refresh')).resolves.toBe(true);
    await expect(client.isToolCallableByApp('forecast')).resolves.toBe(true);
    await expect(client.isToolCallableByApp('search')).resolves.toBe(true);
    expect(listTools).toHaveBeenCalledTimes(1);
  });

  it('refuses while the tools can not be listed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    listTools.mockRejectedValue(new Error('offline'));
    const client = new MCPClient(params, { mcpApps: true });

    await expect(client.isToolCallableByApp('search')).resolves.toBe(false);
  });
});

describe('MCPClient.isToolHiddenFromModel', () => {
  it('names the tools only views may call, from the same listing', async () => {
    listTools.mockResolvedValue({
      tools: [
        { _meta: { ui: { visibility: ['app'] } }, name: 'load_page' },
        { _meta: { ui: { visibility: ['model', 'app'] } }, name: 'forecast' },
        { name: 'search' },
      ],
    });
    const client = new MCPClient(params, { mcpApps: true });

    await expect(client.isToolHiddenFromModel('load_page')).resolves.toBe(true);
    await expect(client.isToolHiddenFromModel('forecast')).resolves.toBe(false);
    await expect(client.isToolHiddenFromModel('search')).resolves.toBe(false);
    expect(listTools).toHaveBeenCalledTimes(1);
  });

  it("lets the model's calls run while the tools can not be listed", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    listTools.mockRejectedValue(new Error('offline'));
    const client = new MCPClient(params, { mcpApps: true });

    await expect(client.isToolHiddenFromModel('load_page')).resolves.toBe(false);
  });
});

describe('web MCPClient after the server changes its tools', () => {
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

describe('web MCPClient.isToolCallableByApp for names the listing did not name', () => {
  it('refuses them: only tools the server offered to views run', async () => {
    listTools.mockResolvedValueOnce({ tools: [{ name: 'search' }] });
    const client = new MCPClient(params, { mcpApps: true });

    await expect(client.isToolCallableByApp('search')).resolves.toBe(true);
    await expect(client.isToolCallableByApp('not_listed')).resolves.toBe(false);
  });
});
