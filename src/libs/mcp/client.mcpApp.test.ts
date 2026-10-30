import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MCPClient } from './client';
import { MCP_APP_CLIENT_CAPABILITIES } from './mcpApp';

const { clientOptions, listTools } = vi.hoisted(() => ({
  clientOptions: [] as unknown[],
  listTools: vi.fn(),
}));

vi.mock('@modelcontextprotocol/client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Client: class {
    getProtocolEra = () => 'legacy';
    listTools = listTools;
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
    new MCPClient(params, { mcpApp: false });
    new MCPClient(params, { mcpApp: true });

    expect(
      clientOptions.map((options) => (options as { capabilities?: unknown }).capabilities),
    ).toEqual([undefined, undefined, MCP_APP_CLIENT_CAPABILITIES]);
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
    const client = new MCPClient(params, { mcpApp: true });

    await expect(client.getToolUiResourceUri('forecast')).resolves.toBe('ui://weather/view');
    await expect(client.getToolUiResourceUri('search')).resolves.toBeUndefined();
    expect(listTools).toHaveBeenCalledTimes(1);
  });

  it('does not list tools again on every call after a failed listing', async () => {
    listTools.mockRejectedValue(new Error('upstream 500'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = new MCPClient(params, { mcpApp: true });

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
    const client = new MCPClient(params, { mcpApp: true });

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
    const client = new MCPClient(params, { mcpApp: true });
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
