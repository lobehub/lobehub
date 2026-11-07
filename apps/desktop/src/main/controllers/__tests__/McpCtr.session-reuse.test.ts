import { deserializeMcpIpcPayload, serializeMcpIpcPayload } from '@lobechat/utils/mcpIpcPayload';
import { SdkError, SdkErrorCode, SdkHttpError } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import McpCtr from '../McpCtr';

const { mcpClientMocks } = vi.hoisted(() => ({
  mcpClientMocks: vi.fn(),
}));

// The controller lazily imports the MCP client module; mock the module so no
// real stdio process is ever spawned. The specifier must mirror the
// controller's own dynamic import (`../libs/mcp/client` relative to McpCtr.ts).
vi.mock('../../libs/mcp/client', () => ({
  MCPClient: class {
    constructor(public params: unknown) {
      return mcpClientMocks();
    }
  },
  MCPConnectionError: class extends Error {
    name = 'MCPConnectionError';
    stderrLogs: string[] = [];
  },
}));

const mockApp = {
  getService: vi.fn(() => null),
} as unknown as App;

const makeClientInstance = (label: string) => ({
  callTool: vi.fn().mockImplementation(async () => ({
    content: [{ text: `${label}-result`, type: 'text' }],
    isError: false,
  })),
  disconnect: vi.fn().mockResolvedValue(undefined),
  getProtocolEra: vi.fn().mockReturnValue('legacy'),
  initialize: vi.fn().mockResolvedValue(undefined),
  listManifests: vi.fn().mockResolvedValue({ tools: [] }),
});

describe('McpCtr stdio session reuse (T-801 stateful MCP servers)', () => {
  let ctr: McpCtr;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
    mcpClientMocks.mockReset();
    ctr = new McpCtr(mockApp);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['My server description'])(
    'keeps stdio descriptions as metadata (%s)',
    async (description) => {
      const instance = {
        ...makeClientInstance('tools-only'),
        listManifests: vi.fn().mockResolvedValue({
          prompts: undefined,
          resources: undefined,
          tools: [{ inputSchema: { type: 'object' }, name: 'hello' }],
        }),
      };
      mcpClientMocks.mockReturnValue(instance);

      const result = await ctr.getStdioMcpServerManifest(
        serializeMcpIpcPayload({
          command: 'test-command',
          metadata: { description },
          name: 'tools-only',
        }),
      );
      const manifest = deserializeMcpIpcPayload<{ api: unknown[]; meta: { description?: string } }>(
        result,
      );

      expect(manifest.api).toHaveLength(1);
      expect(manifest.meta.description).toBe(description);
    },
  );

  it.each(['My server description'])(
    'keeps HTTP descriptions as metadata (%s)',
    async (description) => {
      const instance = { ...makeClientInstance('http'), listTools: vi.fn().mockResolvedValue([]) };
      mcpClientMocks.mockReturnValue(instance);

      const result = await ctr.getStreamableMcpServerManifest(
        serializeMcpIpcPayload({
          identifier: 'empty-server',
          metadata: { description },
          url: 'http://localhost/mcp',
        }),
      );
      const manifest = deserializeMcpIpcPayload<{ api: unknown[]; meta: { description?: string } }>(
        result,
      );

      expect(manifest.api).toEqual([]);
      expect(manifest.meta.description).toBe(description);
    },
  );

  it.each([
    {
      capabilities: { tools: [{ name: 'hello' }] },
      summary: '1 tool',
    },
    {
      capabilities: { prompts: [], resources: [], tools: [] },
      summary: 'no tools, prompts, or resources',
    },
    {
      capabilities: {
        prompts: [{ name: 'greet' }],
        resources: [{ name: 'readme' }],
        tools: [{ name: 'hello' }],
      },
      summary: '1 prompt, 1 resource, 1 tool',
    },
  ])('persists the automatic stdio description: $summary', async ({ capabilities, summary }) => {
    const instance = makeClientInstance('automatic');
    instance.listManifests.mockResolvedValue(capabilities);
    mcpClientMocks.mockReturnValue(instance);

    const result = await ctr.getStdioMcpServerManifest(
      serializeMcpIpcPayload({ command: 'test-command', name: 'automatic' }),
    );
    const manifest = deserializeMcpIpcPayload<{ meta: { description: string } }>(result);

    expect(manifest.meta.description).toBe(`automatic MCP server has ${summary}`);
    expect(manifest.meta.description).not.toContain('undefined');
  });

  it.each([
    { tools: [], summary: 'no tools, prompts, or resources' },
    { tools: [{ name: 'hello' }], summary: '1 tool, like "hello"' },
  ])('persists the automatic HTTP description: $summary', async ({ tools, summary }) => {
    mcpClientMocks.mockReturnValue({
      ...makeClientInstance('automatic'),
      listTools: vi.fn().mockResolvedValue(tools),
    });
    const result = await ctr.getStreamableMcpServerManifest(
      serializeMcpIpcPayload({ identifier: 'automatic', url: 'http://localhost/mcp' }),
    );
    const manifest = deserializeMcpIpcPayload<{ meta: { description: string } }>(result);

    expect(manifest.meta.description).toBe(`automatic MCP server has ${summary}`);
    expect(manifest.meta.description).not.toContain('undefined');
  });

  it('returns a failed tool result without replaying an MCP isError result', async () => {
    const instance = makeClientInstance('failed');
    instance.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'Additional input is unsupported' }],
      isError: true,
    });
    mcpClientMocks.mockReturnValue(instance);
    await expect(
      ctr.runHttpMcpTool({ name: 'modern', url: 'http://localhost/mcp' }, 'needs_input', {}),
    ).resolves.toMatchObject({
      error: { message: 'Additional input is unsupported' },
      success: false,
      state: { isError: true },
    });
    expect(instance.callTool).toHaveBeenCalledOnce();
  });

  it('does not reconnect or replay a modern HTTP tool on 404', async () => {
    const instance = makeClientInstance('modern');
    instance.getProtocolEra.mockReturnValue('modern');
    const error = new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'Endpoint not found', {
      status: 404,
    });
    instance.callTool.mockRejectedValue(error);
    mcpClientMocks.mockReturnValue(instance);
    await expect(
      ctr.runHttpMcpTool({ name: 'modern', url: 'http://localhost/mcp' }, 'write', {}),
    ).rejects.toBe(error);
    expect(mcpClientMocks).toHaveBeenCalledTimes(1);
    expect(instance.callTool).toHaveBeenCalledOnce();
  });

  it('reuses one stdio session across consecutive tool calls (state survives)', async () => {
    const instance = makeClientInstance('first');
    mcpClientMocks.mockReturnValue(instance);

    await ctr.runStdioMcpTool({
      args: '',
      env: undefined,
      params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
      toolName: 'open_database',
    } as any);
    await ctr.runStdioMcpTool({
      args: '',
      env: undefined,
      params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
      toolName: 'execute_python',
    } as any);

    // Exactly ONE MCPClient was constructed for both calls: the stdio
    // process is NOT respawned per call, so server-side state survives.
    expect(mcpClientMocks).toHaveBeenCalledTimes(1);
    expect(instance.callTool).toHaveBeenCalledTimes(2);
    // Pooled sessions are never disconnected between calls.
    expect(instance.disconnect).not.toHaveBeenCalled();
    // Second call actually ran (result produced).
    expect(instance.callTool).toHaveBeenLastCalledWith(
      'execute_python',
      {},
      { continuation: undefined, host: undefined, signal: undefined },
    );
  });

  it('spawns separate sessions for different connection params', async () => {
    const first = makeClientInstance('a');
    const second = makeClientInstance('b');
    mcpClientMocks.mockReturnValueOnce(first).mockReturnValueOnce(second);

    await ctr.runStdioMcpTool({
      args: '',
      env: undefined,
      params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
      toolName: 'open_database',
    } as any);
    await ctr.runStdioMcpTool({
      args: '',
      env: { IDB_PATH: '/other' },
      params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
      toolName: 'open_database',
    } as any);

    expect(mcpClientMocks).toHaveBeenCalledTimes(2);
  });

  it('retries on a fresh session after a stale pooled session fails, then keeps pooling', async () => {
    const stale = makeClientInstance('stale');
    stale.callTool.mockRejectedValue(
      new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'Session not found', {
        status: 404,
      }),
    );
    const fresh = makeClientInstance('fresh');
    mcpClientMocks.mockReturnValueOnce(stale).mockReturnValueOnce(fresh).mockReturnValue(fresh);

    const result = await ctr.runStdioMcpTool({
      args: '',
      env: undefined,
      params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
      toolName: 'execute_python',
    } as any);

    // The stale session was evicted + disconnected, the retry succeeded.
    expect(stale.disconnect).toHaveBeenCalledTimes(1);
    expect(fresh.callTool).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);

    // Next call reuses the replacement session (pool stays warm).
    await ctr.runStdioMcpTool({
      args: '',
      env: undefined,
      params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
      toolName: 'execute_python',
    } as any);
    expect(mcpClientMocks).toHaveBeenCalledTimes(2);
  });

  it('propagates the failure when the fresh retry also fails', async () => {
    mcpClientMocks.mockImplementation(() => {
      const failing = makeClientInstance('failing');
      failing.callTool.mockRejectedValue(
        new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'Session not found', {
          status: 404,
        }),
      );
      return failing;
    });

    await expect(
      ctr.runStdioMcpTool({
        args: '',
        env: undefined,
        params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
        toolName: 'execute_python',
      } as any),
    ).rejects.toThrow('Session not found');
  });

  it('does NOT retry when the tool itself failed at app level (no double-apply of side effects)', async () => {
    const pooled = makeClientInstance('pooled');
    pooled.callTool.mockRejectedValue(
      new Error('no open database instance; call open_database() first'),
    );
    mcpClientMocks.mockReturnValue(pooled);

    await expect(
      ctr.runStdioMcpTool({
        args: '',
        env: undefined,
        params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
        toolName: 'execute_python',
      } as any),
    ).rejects.toThrow('no open database instance');

    // App-level failure: no eviction, no disconnect, no second invocation.
    expect(pooled.callTool).toHaveBeenCalledTimes(1);
    expect(pooled.disconnect).not.toHaveBeenCalled();
    expect(mcpClientMocks).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry when post-processing (media upload) fails after a successful tool run', async () => {
    const pooled = makeClientInstance('pooled');
    // Return an image block so processContentBlocks runs the media upload.
    pooled.callTool.mockResolvedValue({
      content: [{ data: 'aW1hZ2U=', mimeType: 'image/png', type: 'image' }],
      isError: false,
    });
    mcpClientMocks.mockReturnValue(pooled);
    // Simulate media upload failure inside processContentBlocks.
    (ctr as any).app.getService = vi.fn(() => ({
      getFileHTTPURL: vi.fn(),
      uploadFile: vi.fn().mockRejectedValue(new Error('upload unavailable')),
    }));

    await expect(
      ctr.runStdioMcpTool({
        args: '',
        env: undefined,
        params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
        toolName: 'render_screenshot',
      } as any),
    ).rejects.toThrow('upload unavailable');

    // The tool ran exactly once — its side effect must not be re-applied.
    expect(pooled.callTool).toHaveBeenCalledTimes(1);
    expect(pooled.disconnect).not.toHaveBeenCalled();
  });

  it('preserves CLI argument order in pool keys (reordered argv must not share a session)', async () => {
    mcpClientMocks.mockImplementation(() => makeClientInstance('x'));

    await ctr.runStdioMcpTool({
      args: '',
      env: undefined,
      params: { args: ['--port', '8080', 'serve'], command: 'svc', name: 'svc' },
      toolName: 'ping',
    } as any);
    await ctr.runStdioMcpTool({
      args: '',
      env: undefined,
      params: { args: ['serve', '--port', '8080'], command: 'svc', name: 'svc' },
      toolName: 'ping',
    } as any);

    // Same tokens, different order → distinct sessions, never reused.
    expect(mcpClientMocks).toHaveBeenCalledTimes(2);
  });

  it('evicts the pooled client when listManifests fails on a stale session', async () => {
    const seeded = makeClientInstance('seeded');
    seeded.listManifests.mockRejectedValue(
      new SdkError(SdkErrorCode.ConnectionClosed, 'Connection closed'),
    );
    mcpClientMocks.mockReturnValue(seeded);

    await expect(
      ctr.getStdioMcpServerManifest({
        args: ['--stdio'],
        command: 'ida-mcp',
        name: 'ida-mcp',
      } as any),
    ).rejects.toThrow('Connection closed');

    // Broken session evicted + disconnected, so the next refresh starts fresh.
    expect(seeded.disconnect).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on a generic JSON-RPC -32000 app-level error (no double side effects)', async () => {
    const pooled = makeClientInstance('pooled');
    // Generic -32000 is the server-side application error range — a mutating
    // tool may have already applied its effect, so retrying is forbidden.
    pooled.callTool.mockRejectedValue(
      Object.assign(new Error('tool execution failed'), { code: -32000 }),
    );
    mcpClientMocks.mockReturnValue(pooled);

    await expect(
      ctr.runStdioMcpTool({
        args: '',
        env: undefined,
        params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
        toolName: 'delete_record',
      } as any),
    ).rejects.toThrow('tool execution failed');

    // Exactly one invocation, no eviction, no disconnect.
    expect(pooled.callTool).toHaveBeenCalledTimes(1);
    expect(pooled.disconnect).not.toHaveBeenCalled();
    expect(mcpClientMocks).toHaveBeenCalledTimes(1);
  });

  it('single-flights concurrent same-key initialization (no duplicate stdio processes)', async () => {
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let created = 0;
    mcpClientMocks.mockImplementation(() => {
      created += 1;
      const instance = makeClientInstance(`c${created}`);
      // Block inside initialize(): the constructor returns synchronously,
      // initialization is where the (slow) stdio handshake would happen.
      instance.initialize.mockImplementation(async () => {
        await gate;
      });
      return instance;
    });

    const params = {
      args: '',
      env: undefined,
      params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
      toolName: 'open_database',
    } as any;

    const first = ctr.runStdioMcpTool(params);
    // Let the first call reach its pending initialize() before the second.
    await vi.waitFor(() => expect(mcpClientMocks).toHaveBeenCalledTimes(1));
    const second = ctr.runStdioMcpTool(params);

    // Release the gate; both calls must share the one client.
    releaseGate();
    await Promise.all([first, second]);

    // Only one MCPClient was ever constructed for both concurrent calls.
    expect(mcpClientMocks).toHaveBeenCalledTimes(1);
  });

  it('evicts the replacement session when its retry also fails (pool never serves a dead client)', async () => {
    const stale = makeClientInstance('stale');
    stale.callTool.mockRejectedValue(
      new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'Session not found', {
        status: 404,
      }),
    );
    const replacement = makeClientInstance('replacement');
    replacement.callTool.mockRejectedValue(
      new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'Session not found', {
        status: 404,
      }),
    );
    mcpClientMocks
      .mockReturnValueOnce(stale)
      .mockReturnValueOnce(replacement)
      .mockReturnValue(replacement);

    await expect(
      ctr.runStdioMcpTool({
        args: '',
        env: undefined,
        params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
        toolName: 'execute_python',
      } as any),
    ).rejects.toThrow('Session not found');

    // Both the stale session and the proven-dead replacement were evicted.
    expect(stale.disconnect).toHaveBeenCalledTimes(1);
    expect(replacement.disconnect).toHaveBeenCalledTimes(1);
  });

  it('single-flights the replacement when two concurrent calls share a stale session', async () => {
    const shared = makeClientInstance('stale-shared');
    shared.callTool.mockRejectedValue(
      new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'Session not found', {
        status: 404,
      }),
    );
    const replacement = makeClientInstance('replacement');
    mcpClientMocks
      .mockReturnValueOnce(shared) // both concurrent calls pool-acquire this
      .mockReturnValueOnce(replacement) // single-flight creates ONE replacement
      .mockReturnValue(replacement);

    const params = {
      args: '',
      env: undefined,
      params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
      toolName: 'execute_python',
    } as any;

    // Two concurrent calls share the stale session; both fail stale and both
    // enter the retry path.
    const [r1, r2] = await Promise.allSettled([
      ctr.runStdioMcpTool(params),
      ctr.runStdioMcpTool(params),
    ]);

    // Replacement creation went through the single-flight path: exactly one
    // replacement client was ever constructed (no racing duplicate process).
    expect(mcpClientMocks).toHaveBeenCalledTimes(2);

    // The winner returns success through the shared replacement.
    const fulfilled = [r1, r2].filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    void replacement;
  });

  it('keeps the healthy replacement pooled when its post-processing fails after a successful tool run', async () => {
    const stale = makeClientInstance('stale');
    stale.callTool.mockRejectedValue(
      new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'Session not found', {
        status: 404,
      }),
    );
    const fresh = makeClientInstance('fresh');
    fresh.callTool.mockResolvedValue({
      content: [
        { data: 'aGVsbG8=', mimeType: 'image/png', type: 'image' },
        { text: 'tool ran fine', type: 'text' },
      ],
      isError: false,
    });
    mcpClientMocks.mockReturnValueOnce(stale).mockReturnValueOnce(fresh).mockReturnValue(fresh);

    // Post-processing (media upload) fails AFTER the tool succeeded.
    const uploadSpy = vi
      .spyOn(ctr as any, 'uploadMcpMediaBlock')
      .mockRejectedValue(new Error('upload failed'));

    await expect(
      ctr.runStdioMcpTool({
        args: '',
        env: undefined,
        params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
        toolName: 'render_chart',
      } as any),
    ).rejects.toThrow('upload failed');

    uploadSpy.mockRestore();

    // The tool DID run on the replacement (state established server-side).
    expect(fresh.callTool).toHaveBeenCalledTimes(1);
    // A post-processing error is not a session problem — the healthy
    // replacement stays pooled, never disconnected.
    expect(fresh.disconnect).not.toHaveBeenCalled();
  });

  it('reaps idle sessions past the TTL but keeps actively used ones (config change cleanup)', async () => {
    vi.useFakeTimers();
    try {
      const oldSession = makeClientInstance('old');
      const activeSession = makeClientInstance('active');
      const freshSession = makeClientInstance('fresh');
      mcpClientMocks
        .mockReturnValueOnce(oldSession)
        .mockReturnValueOnce(activeSession)
        .mockReturnValue(freshSession);

      const oldParams = {
        args: '',
        env: { TOKEN: 'v1' },
        params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
        toolName: 'open_database',
      } as any;
      await ctr.runStdioMcpTool(oldParams);

      // User rotates the token → new cache key, new session; the old entry
      // (now obsolete) stays connected until the idle reaper collects it.
      const newParams = {
        args: '',
        env: { TOKEN: 'v2' },
        params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
        toolName: 'open_database',
      } as any;
      await ctr.runStdioMcpTool(newParams);
      expect(mcpClientMocks).toHaveBeenCalledTimes(2);

      // The v2 session is actively used again within the TTL window.
      await ctr.runStdioMcpTool(newParams);
      expect(activeSession.disconnect).not.toHaveBeenCalled();

      // Advance past the TTL: the untouched v1 entry is reaped, the
      // refreshed v2 entry survives.
      await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
      await ctr.runStdioMcpTool(newParams);

      expect(oldSession.disconnect).toHaveBeenCalledTimes(1);
      expect(activeSession.disconnect).not.toHaveBeenCalled();
      // v2 was still pooled (not rebuilt after reaping).
      expect(mcpClientMocks).toHaveBeenCalledTimes(2);
      void freshSession;
    } finally {
      vi.useRealTimers();
    }
  });

  it('dispose-all disconnects every pooled session (app shutdown path)', async () => {
    const a = makeClientInstance('a');
    const b = makeClientInstance('b');
    mcpClientMocks.mockReturnValueOnce(a).mockReturnValueOnce(b);

    await ctr.runStdioMcpTool({
      args: '',
      env: undefined,
      params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
      toolName: 't',
    } as any);
    await ctr.runStdioMcpTool({
      args: '',
      env: { TOKEN: 'x' },
      params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
      toolName: 't',
    } as any);

    await (ctr as any).disposeAllPooledClients();

    expect(a.disconnect).toHaveBeenCalledTimes(1);
    expect(b.disconnect).toHaveBeenCalledTimes(1);
  });

  it('defers eviction disconnect until in-flight calls release the shared client (concurrent manifest + stale tool call)', async () => {
    // Manifest discovery holds a pending listManifests while concurrent tool
    // calls on the same pooled session fail with stale-session errors. The
    // eviction must leave the pool immediately but NOT disconnect the shared
    // client while the manifest request still holds its lease.
    const shared = makeClientInstance('shared');
    shared.callTool.mockRejectedValue(
      new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'Session not found', {
        status: 404,
      }),
    );
    mcpClientMocks.mockImplementation(() => shared);

    let releaseManifest!: () => void;
    shared.listManifests.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseManifest = resolve;
        }),
    );

    const params = {
      args: '',
      env: undefined,
      params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
      toolName: 't',
    } as any;

    const manifestPromise = ctr.getStdioMcpServerManifest(params);
    await vi.waitFor(() => {
      expect(shared.listManifests).toHaveBeenCalled();
    });

    // First tool call: stale error → evicts the shared client → retry on
    // the replacement (same mocked instance) → stale again → propagates.
    await expect(ctr.runStdioMcpTool({ ...params, toolName: 'explode' } as any)).rejects.toThrow(
      'Session not found',
    );
    // Eviction happened (client left the pool) but the disconnect is
    // deferred while the manifest call still holds its lease.
    expect(shared.disconnect).not.toHaveBeenCalled();

    void manifestPromise.catch(() => {});
    releaseManifest!();
    await manifestPromise.catch(() => {});
    // Once the last lease is released, the deferred evictions land. The
    // retry eviction may add a second disconnect on the same mocked
    // instance; the contract under test is "no disconnect while a manifest
    // request is pending", not the exact eviction count.
    await vi.waitFor(() => {
      expect(shared.disconnect.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('idle reaper skips sessions with active leases (long call past TTL)', async () => {
    vi.useFakeTimers();
    try {
      const longCall = makeClientInstance('long');
      mcpClientMocks.mockReturnValue(longCall);
      longCall.callTool.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  content: [{ text: 'done', type: 'text' }],
                  isError: false,
                }),
              40 * 60 * 1000,
            );
          }),
      );

      const params = {
        args: '',
        env: undefined,
        params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
        toolName: 't',
      } as any;

      const callPromise = ctr.runStdioMcpTool(params);
      await vi.advanceTimersByTimeAsync(31 * 60 * 1000);

      // Still inside the 40-minute call: the idle sweep (TTL 30 min) must
      // not reap the session mid-call even though lastUsedAt is stale.
      expect(longCall.disconnect).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(40 * 60 * 1000);
      await callPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops the idle-clock entry when client initialization fails (no credential-keyed leak)', async () => {
    const failing = makeClientInstance('failing');
    failing.initialize.mockRejectedValue(new Error('spawn failed'));
    mcpClientMocks.mockReturnValue(failing);

    await expect(
      ctr.runStdioMcpTool({
        args: '',
        env: { TOKEN: 'secret-v1' },
        params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
        toolName: 't',
      } as any),
    ).rejects.toThrow('spawn failed');

    const clocks = (ctr as any).mcpClientLastUsedAt as Map<string, number>;
    expect(clocks.size).toBe(0);
  });

  it('evicts a dead stdio subprocess WITHOUT replaying the call (P1: dead transport)', async () => {
    // SDK surfaces an exited subprocess as "Connection closed" (in-flight
    // request) or "Not connected" (request issued after close). Neither
    // may be retried blindly (a mutating tool could double-apply), but the
    // dead client MUST leave the pool — otherwise every later call
    // refreshes and reuses the corpse.
    const dead = makeClientInstance('dead');
    dead.callTool.mockRejectedValue(
      new SdkError(SdkErrorCode.ConnectionClosed, 'Connection closed'),
    );
    const replacement = makeClientInstance('replacement');
    mcpClientMocks.mockReturnValueOnce(dead).mockReturnValue(replacement);

    await expect(
      ctr.runStdioMcpTool({
        args: '',
        env: undefined,
        params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
        toolName: 'delete_record',
      } as any),
    ).rejects.toThrow('Connection closed');

    // Dead session evicted + disconnected; the failure was still surfaced
    // (no silent replay of the mutating call).
    expect(dead.disconnect).toHaveBeenCalledTimes(1);
    expect(dead.callTool).toHaveBeenCalledTimes(1);
    expect(replacement.callTool).not.toHaveBeenCalled();
    expect(mcpClientMocks).toHaveBeenCalledTimes(1);

    // The next call builds a FRESH session instead of reusing the corpse.
    await ctr.runStdioMcpTool({
      args: '',
      env: undefined,
      params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
      toolName: 'open_database',
    } as any);
    expect(mcpClientMocks).toHaveBeenCalledTimes(2);
    expect(replacement.callTool).toHaveBeenCalledTimes(1);
  });

  it('does NOT evict on a server-side app error that merely mentions "Connection closed"', async () => {
    // Exact-match guard: only the SDK's exact transport-failure messages
    // qualify; a server application error containing the words must not
    // kill a healthy pooled session.
    const pooled = makeClientInstance('pooled');
    pooled.callTool.mockRejectedValue(
      Object.assign(new Error('Connection closed by tool sandbox'), { code: -32000 }),
    );
    mcpClientMocks.mockReturnValue(pooled);

    await expect(
      ctr.runStdioMcpTool({
        args: '',
        env: undefined,
        params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
        toolName: 't',
      } as any),
    ).rejects.toThrow('Connection closed by tool sandbox');

    expect(pooled.disconnect).not.toHaveBeenCalled();
    expect(mcpClientMocks).toHaveBeenCalledTimes(1);
  });

  it('refreshes the idle clock when the last lease is released (long call past TTL)', async () => {
    vi.useFakeTimers();
    try {
      const longCall = makeClientInstance('long');
      const unrelated = makeClientInstance('unrelated');
      mcpClientMocks
        .mockReturnValueOnce(longCall)
        .mockReturnValueOnce(unrelated)
        .mockReturnValue(unrelated);

      longCall.callTool.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  content: [{ text: 'done', type: 'text' }],
                  isError: false,
                }),
              40 * 60 * 1000,
            );
          }),
      );

      const longParams = {
        args: '',
        env: undefined,
        params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
        toolName: 't',
      } as any;
      const callPromise = ctr.runStdioMcpTool(longParams);
      await vi.advanceTimersByTimeAsync(40 * 60 * 1000);
      await callPromise;

      // The long call ended NOW. A different MCP key acquiring afterwards
      // triggers a sweep: the just-finished session must survive because
      // its clock was refreshed at lease release, not at acquisition.
      await ctr.runStdioMcpTool({
        args: '',
        env: { TOKEN: 'other' },
        params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
        toolName: 't',
      } as any);

      expect(longCall.disconnect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('will-quit disposal initiates every disconnect synchronously (Electron cannot await listeners)', async () => {
    const a = makeClientInstance('a');
    const b = makeClientInstance('b');
    let releaseA: () => void = () => {};
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    a.disconnect.mockImplementation(async () => {
      await gateA;
    });
    mcpClientMocks.mockReturnValueOnce(a).mockReturnValueOnce(b);

    await ctr.runStdioMcpTool({
      args: '',
      env: undefined,
      params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
      toolName: 't',
    } as any);
    await ctr.runStdioMcpTool({
      args: '',
      env: { TOKEN: 'x' },
      params: { args: ['--stdio'], command: 'ida-mcp', name: 'ida-mcp' },
      toolName: 't',
    } as any);

    // The disposal promise resolves only after BOTH teardowns settle, and
    // both were initiated up front (b's disconnect is called before a's
    // gated one resolves) — so Electron's non-awaiting will-quit still
    // reaches every stdio child.
    const disposal = (ctr as any).disposeAllPooledClients();
    await vi.waitFor(() => expect(b.disconnect).toHaveBeenCalledTimes(1));
    expect(a.disconnect).toHaveBeenCalledTimes(1);
    releaseA();
    await disposal;

    expect(a.disconnect).toHaveBeenCalledTimes(1);
    expect(b.disconnect).toHaveBeenCalledTimes(1);
  });
});
