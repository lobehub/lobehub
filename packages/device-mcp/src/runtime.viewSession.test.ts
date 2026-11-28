import { describe, expect, it, vi } from 'vitest';

import { DeviceMcpRuntime } from './runtime';

const { created } = vi.hoisted(() => ({ created: [] as any[] }));

// One mocked session per created client, so the test sees which process served each call
vi.mock('./client', () => ({
  MCPClient: class {
    constructor(params: unknown, options: unknown) {
      const client = {
        callTool: vi.fn(async (name: string) => ({
          content: [{ text: `${name} on session ${created.length}`, type: 'text' }],
          isError: false,
        })),
        disconnect: vi.fn(async () => {}),
        getProtocolEra: () => 'legacy',
        getToolUiMeta: vi.fn(async () => undefined),
        getToolUiResourceUri: vi.fn(async () => 'ui://app/view'),
        initialize: vi.fn(),
        isToolCallableByApp: vi.fn(async () => true),
        isToolHiddenFromModel: vi.fn(async () => false),
        listResources: vi.fn(async () => []),
        options,
        params,
        readResource: vi.fn(async (uri: string) => ({ contents: [{ text: '<p/>', uri }] })),
      };
      created.push(client);
      return client;
    }
  },
  MCPConnectionError: class extends Error {},
}));

const params = { args: ['server.mjs'], command: 'node', name: 'app', type: 'stdio' as const };

describe('DeviceMcpRuntime — a view reaches the session its tool ran on', () => {
  it("serves a view's reads and calls from the interactive session that produced the result", async () => {
    created.length = 0;
    const runtime = new DeviceMcpRuntime({
      getMediaUrl: async (key) => key,
      uploadMedia: async () => undefined,
    });
    // An agent run's call carries an interaction host (elicitation), so it
    // runs on the session that announces elicitation
    await runtime.runTool(
      params,
      'show',
      {},
      {
        interaction: { host: { request: vi.fn() } as any, signal: new AbortController().signal },
        mcpApps: true,
      },
    );
    expect(created).toHaveLength(1);

    await runtime.readUiResource(params, 'ui://app/view');
    await runtime.runTool(params, 'frame', {}, { fromApp: true, mcpApps: true });

    // No second process: the view keeps the state its tool established
    expect(created).toHaveLength(1);
    expect(created[0].readResource).toHaveBeenCalledWith('ui://app/view');
    expect(created[0].callTool).toHaveBeenCalledWith('frame', {});
    await runtime.dispose();
  });
});
