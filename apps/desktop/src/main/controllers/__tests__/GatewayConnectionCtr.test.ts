import type * as ChildProcessModule from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';
import GatewayConnectionService from '@/services/gatewayConnectionSrv';
import ImessageBridgeService from '@/services/imessageBridgeSrv';

import GatewayConnectionCtr from '../GatewayConnectionCtr';
import HeterogeneousAgentCtr from '../HeterogeneousAgentCtr';
import LocalFileCtr from '../LocalFileCtr';
import McpCtr from '../McpCtr';
import RemoteServerConfigCtr from '../RemoteServerConfigCtr';
import ShellCommandCtr from '../ShellCommandCtr';

// ─── Mocks ───

const { ipcMainHandleMock, MockGatewayClient } = vi.hoisted(() => {
  const { EventEmitter } = require('node:events');

  // Must be defined inside vi.hoisted so it's available when vi.mock factories run
  class _MockGatewayClient extends EventEmitter {
    static lastInstance: _MockGatewayClient | null = null;
    static lastOptions: any = null;

    connectionStatus = 'disconnected' as string;
    currentDeviceId: string;

    connect = vi.fn(async () => {
      this.connectionStatus = 'connecting';
      this.emit('status_changed', 'connecting');
    });

    disconnect = vi.fn(async () => {
      this.connectionStatus = 'disconnected';
    });

    sendToolCallResponse = vi.fn();
    sendMessageApiResponse = vi.fn();
    sendAgentRunAck = vi.fn();

    constructor(options: any) {
      super();
      this.currentDeviceId = options.deviceId || 'mock-device-id';
      _MockGatewayClient.lastInstance = this;
      _MockGatewayClient.lastOptions = options;
    }

    // Test helpers
    simulateConnected() {
      this.connectionStatus = 'connected';
      this.emit('status_changed', 'connected');
      this.emit('connected');
    }

    simulateStatusChanged(status: string) {
      this.connectionStatus = status;
      this.emit('status_changed', status);
    }

    simulateToolCallRequest(apiName: string, args: object, requestId = 'req-1') {
      this.emit('tool_call_request', {
        requestId,
        toolCall: {
          apiName,
          arguments: JSON.stringify(args),
          identifier: 'test-tool',
        },
        type: 'tool_call_request',
      });
    }

    simulateMcpCallRequest(
      apiName: string,
      args: object,
      params: object,
      requestId = 'mcp-req-1',
      identifier = 'kimi-datasource',
    ) {
      this.emit('tool_call_request', {
        requestId,
        toolCall: {
          apiName,
          arguments: JSON.stringify(args),
          identifier,
          params,
          type: 'mcp',
        },
        type: 'tool_call_request',
      });
    }

    simulateMessageApiRequest(
      platform: string,
      apiName: string,
      payload: Record<string, unknown>,
      requestId = 'msg-req-1',
    ) {
      this.emit('message_api_request', {
        api: { apiName, payload, platform },
        requestId,
        type: 'message_api_request',
      });
    }

    simulateAuthExpired() {
      this.emit('auth_expired');
    }

    simulateError(message: string) {
      this.emit('error', new Error(message));
    }

    simulateAgentRunRequest(
      agentType: string,
      operationId = 'op-1',
      prompt = 'hello',
      jwt = 'mock-jwt',
      extra: Record<string, unknown> = {},
    ) {
      this.emit('agent_run_request', {
        agentType,
        jwt,
        operationId,
        prompt,
        topicId: 'topic-1',
        type: 'agent_run_request',
        ...extra,
      });
    }

    simulateReconnecting(delay: number) {
      this.connectionStatus = 'reconnecting';
      this.emit('status_changed', 'reconnecting');
      this.emit('reconnecting', delay);
    }
  }

  return {
    MockGatewayClient: _MockGatewayClient,
    ipcMainHandleMock: vi.fn(),
  };
});

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/mock/app'),
    getPath: vi.fn((name: string) => `/mock/${name}`),
    getVersion: vi.fn(() => '1.2.3'),
  },
  ipcMain: { handle: ipcMainHandleMock },
  powerSaveBlocker: {
    start: vi.fn(() => 1),
    stop: vi.fn(),
  },
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    verbose: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('@/utils/platform', () => ({
  macOS: vi.fn(() => false),
  windows: vi.fn(() => false),
  linux: vi.fn(() => false),
}));

vi.mock('@/const/env', () => ({
  OFFICIAL_CLOUD_SERVER: 'https://lobehub-cloud.com',
  isMac: false,
  isWindows: false,
  isLinux: false,
  isDev: false,
}));

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'mock-device-uuid'),
}));

const execFileSyncMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());
const executeRemotePlatformMock = vi.hoisted(() => vi.fn());
const prepareRemotePlatformSpawnMock = vi.hoisted(() => vi.fn());
const resolveRemotePlatformCommandMock = vi.hoisted(() => vi.fn());
const resolveRemotePlatformRuntimeMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>();
  return { ...actual, execFileSync: execFileSyncMock, spawn: spawnMock };
});

vi.mock('@lobechat/heterogeneous-agents/scanHost', () => ({
  resolveRemotePlatformCommand: resolveRemotePlatformCommandMock,
  resolveRemotePlatformRuntime: resolveRemotePlatformRuntimeMock,
}));

vi.mock('node:os', () => ({
  default: { hostname: vi.fn(() => 'mock-hostname'), tmpdir: vi.fn(() => '/tmp') },
}));

vi.mock('@lobechat/device-gateway-client', () => ({
  GatewayClient: MockGatewayClient,
}));

vi.mock('@/services/imessageBridgeSrv', () => ({
  default: class ImessageBridgeService {},
}));

vi.mock('fast-glob', () => ({ default: vi.fn().mockResolvedValue([]) }));
vi.mock('fflate', () => ({ unzipSync: vi.fn() }));

// ─── Mock Controllers ───

const mockLocalFileCtr = {
  handleEditFile: vi.fn().mockResolvedValue({ success: true }),
  handleGlobFiles: vi.fn().mockResolvedValue({ files: [] }),
  handleGrepContent: vi.fn().mockResolvedValue({ matches: [] }),
  handleLocalFilesSearch: vi.fn().mockResolvedValue([]),
  handleMoveFiles: vi.fn().mockResolvedValue([]),
  handleRenameFile: vi.fn().mockResolvedValue({ newPath: '/mock/renamed.txt', success: true }),
  handleWriteFile: vi.fn().mockResolvedValue({ success: true }),
  listLocalFiles: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue({
    charCount: 12,
    content: 'file content',
    createdTime: new Date('2024-01-01'),
    filename: 'test.txt',
    fileType: '.txt',
    lineCount: 1,
    loc: [1, 1] as [number, number],
    modifiedTime: new Date('2024-01-01'),
    totalCharCount: 12,
    totalLineCount: 1,
  }),
} as unknown as LocalFileCtr;

const mockShellCommandCtr = {
  handleGetCommandOutput: vi.fn().mockResolvedValue({ output: '' }),
  handleKillCommand: vi.fn().mockResolvedValue({ success: true }),
  handleRunCommand: vi.fn().mockResolvedValue({ success: true, stdout: '' }),
} as unknown as ShellCommandCtr;

const mockHeterogeneousAgentCtr = {
  cancelLhHeteroExec: vi.fn().mockResolvedValue(undefined),
  sendPrompt: vi.fn().mockResolvedValue(undefined),
  spawnLhHeteroExec: vi.fn().mockResolvedValue({ status: 'accepted' }),
  startSession: vi.fn().mockResolvedValue({ sessionId: 'mock-session-id' }),
} as unknown as HeterogeneousAgentCtr;

const mockImessageBridgeSrv = {
  handleGatewayMessageApi: vi.fn().mockResolvedValue({ ok: true }),
} as unknown as ImessageBridgeService;

const mockMcpCtr = {
  runStdioMcpTool: vi.fn().mockResolvedValue({ content: 'mcp result', state: {}, success: true }),
} as unknown as McpCtr;

const mockRemoteServerConfigCtr = {
  getAccessToken: vi.fn().mockResolvedValue('mock-access-token'),
  getRemoteServerUrl: vi.fn().mockResolvedValue('https://server.example.com'),
  isRemoteServerConfigured: vi.fn().mockResolvedValue(true),
  refreshAccessToken: vi.fn().mockResolvedValue({ success: true }),
} as unknown as RemoteServerConfigCtr;

const mockBroadcast = vi.fn();
const mockStoreGet = vi.fn();
const mockStoreSet = vi.fn();

const mockApp = {
  browserManager: { broadcastToAllWindows: mockBroadcast },
  getController: vi.fn((Cls) => {
    if (Cls === RemoteServerConfigCtr) return mockRemoteServerConfigCtr;
    if (Cls === LocalFileCtr) return mockLocalFileCtr;
    if (Cls === ShellCommandCtr) return mockShellCommandCtr;
    if (Cls === HeterogeneousAgentCtr) return mockHeterogeneousAgentCtr;
    if (Cls === McpCtr) return mockMcpCtr;
    return null;
  }),
  getService: vi.fn((Cls) => {
    if (Cls === GatewayConnectionService) return mockGatewayConnectionSrv;
    if (Cls === ImessageBridgeService) return mockImessageBridgeSrv;
    return null;
  }),
  storeManager: { get: mockStoreGet, set: mockStoreSet },
} as unknown as App;

// Lazily initialized — created in beforeEach so it uses the current mockApp
let mockGatewayConnectionSrv: GatewayConnectionService;

// ─── Test Suite ───

describe('GatewayConnectionCtr', () => {
  let ctr: GatewayConnectionCtr;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resolveRemotePlatformRuntimeMock.mockImplementation(
      async (type: 'hermes' | 'openclaw', baseEnv: NodeJS.ProcessEnv = process.env) => ({
        available: true,
        execute: executeRemotePlatformMock,
        prepareSpawn: (args: string[]) => prepareRemotePlatformSpawnMock(type, args, baseEnv),
      }),
    );
    prepareRemotePlatformSpawnMock.mockImplementation(
      async (type: 'hermes' | 'openclaw', args: string[], baseEnv: NodeJS.ProcessEnv) => ({
        args,
        command: `/resolved/bin/${type}`,
        env: { ...baseEnv, PATH: '/resolved/bin:/usr/bin' },
      }),
    );
    executeRemotePlatformMock.mockResolvedValue({ stderr: '', stdout: '' });
    MockGatewayClient.lastInstance = null;
    MockGatewayClient.lastOptions = null;
    mockStoreGet.mockImplementation((key: string) => {
      if (key === 'gatewayEnabled') return true;
      return undefined;
    });

    mockGatewayConnectionSrv = new GatewayConnectionService(mockApp);
    ctr = new GatewayConnectionCtr(mockApp);
  });

  afterEach(() => {
    ctr.disconnect();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  // ─── Connection ───

  describe('connect', () => {
    it('should create GatewayClient with correct options', async () => {
      mockStoreGet.mockImplementation((key: string) => {
        if (key === 'gatewayEnabled') return true;
        if (key === 'gatewayDeviceId') return 'stored-device-id';
        if (key === 'gatewayUrl') return undefined;
        return undefined;
      });

      ctr = new GatewayConnectionCtr(mockApp);
      ctr.afterFirstFrame();
      await vi.advanceTimersByTimeAsync(0);

      const options = MockGatewayClient.lastOptions;
      expect(options).not.toBeNull();
      expect(options.token).toBe('mock-access-token');
      expect(options.deviceId).toBe('stored-device-id');
      expect(options.gatewayUrl).toBe('https://device-gateway.lobehub.com');
      expect(options.logger).toBeDefined();
      expect(options.userAgent).toBe('LobeHub Desktop/1.2.3');
    });

    it('should use custom gateway URL from store when set', async () => {
      mockStoreGet.mockImplementation((key: string) => {
        if (key === 'gatewayEnabled') return true;
        if (key === 'gatewayUrl') return 'http://localhost:8787';
        return undefined;
      });

      ctr = new GatewayConnectionCtr(mockApp);
      ctr.afterFirstFrame();
      await vi.advanceTimersByTimeAsync(0);

      expect(MockGatewayClient.lastOptions.gatewayUrl).toBe('http://localhost:8787');
    });

    it('should return success:false when no access token', async () => {
      // Prevent auto-connect, then set up providers manually
      vi.mocked(mockRemoteServerConfigCtr.isRemoteServerConfigured).mockResolvedValueOnce(false);
      ctr.afterFirstFrame();
      await vi.advanceTimersByTimeAsync(0);

      vi.mocked(mockRemoteServerConfigCtr.getAccessToken).mockResolvedValueOnce(null);

      const result = await ctr.connect();
      expect(result).toEqual({ error: 'No access token available', success: false });
      expect(MockGatewayClient.lastInstance).toBeNull();
    });

    it('should persist gatewayEnabled=true on connect', async () => {
      vi.mocked(mockRemoteServerConfigCtr.isRemoteServerConfigured).mockResolvedValueOnce(false);
      ctr.afterFirstFrame();
      await vi.advanceTimersByTimeAsync(0);
      mockStoreSet.mockClear();

      await ctr.connect();
      expect(mockStoreSet).toHaveBeenCalledWith('gatewayEnabled', true);
    });

    it('should no-op when already connected', async () => {
      ctr.afterFirstFrame();
      await vi.advanceTimersByTimeAsync(0);
      const firstClient = MockGatewayClient.lastInstance;
      firstClient!.simulateConnected();

      const result = await ctr.connect();
      expect(result).toEqual({ success: true });
      // No new client created
      expect(MockGatewayClient.lastInstance).toBe(firstClient);
    });

    it('should broadcast status changes: disconnected → connecting → connected', async () => {
      ctr.afterFirstFrame();
      await vi.advanceTimersByTimeAsync(0);
      expect(mockBroadcast).toHaveBeenCalledWith('gatewayConnectionStatusChanged', {
        status: 'connecting',
      });

      MockGatewayClient.lastInstance!.simulateConnected();
      expect(mockBroadcast).toHaveBeenCalledWith('gatewayConnectionStatusChanged', {
        status: 'connected',
      });
    });
  });

  // ─── Disconnect ───

  describe('disconnect', () => {
    it('should disconnect client and set status to disconnected', async () => {
      ctr.afterFirstFrame();
      await vi.advanceTimersByTimeAsync(0);
      const client = MockGatewayClient.lastInstance!;
      client.simulateConnected();
      mockBroadcast.mockClear();

      await ctr.disconnect();

      expect(client.disconnect).toHaveBeenCalled();
      expect(mockBroadcast).toHaveBeenCalledWith('gatewayConnectionStatusChanged', {
        status: 'disconnected',
      });
    });

    it('should persist gatewayEnabled=false on disconnect', async () => {
      ctr.afterFirstFrame();
      await vi.advanceTimersByTimeAsync(0);
      MockGatewayClient.lastInstance!.simulateConnected();
      mockStoreSet.mockClear();

      await ctr.disconnect();
      expect(mockStoreSet).toHaveBeenCalledWith('gatewayEnabled', false);
    });

    it('should not trigger reconnect after intentional disconnect', async () => {
      ctr.afterFirstFrame();
      await vi.advanceTimersByTimeAsync(0);
      const client = MockGatewayClient.lastInstance!;
      client.simulateConnected();

      await ctr.disconnect();
      mockBroadcast.mockClear();

      // Advance timers — no reconnect should happen
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockBroadcast).not.toHaveBeenCalledWith('gatewayConnectionStatusChanged', {
        status: 'reconnecting',
      });
    });
  });

  // ─── Auto-Connect ───

  describe('afterFirstFrame (auto-connect)', () => {
    it('should auto-connect when server is configured and token exists', async () => {
      ctr.afterFirstFrame();
      await vi.advanceTimersByTimeAsync(0);

      expect(MockGatewayClient.lastInstance).not.toBeNull();
      expect(MockGatewayClient.lastInstance!.connect).toHaveBeenCalled();
    });

    it('should skip auto-connect when gatewayEnabled is false', async () => {
      mockStoreGet.mockImplementation((key: string) => {
        if (key === 'gatewayEnabled') return false;
        return undefined;
      });

      ctr = new GatewayConnectionCtr(mockApp);
      ctr.afterFirstFrame();
      await vi.advanceTimersByTimeAsync(0);

      expect(MockGatewayClient.lastInstance).toBeNull();
    });

    it('should skip auto-connect when remote server not configured', async () => {
      vi.mocked(mockRemoteServerConfigCtr.isRemoteServerConfigured).mockResolvedValueOnce(false);

      ctr.afterFirstFrame();
      await vi.advanceTimersByTimeAsync(0);

      expect(MockGatewayClient.lastInstance).toBeNull();
    });

    it('should skip auto-connect when no access token', async () => {
      vi.mocked(mockRemoteServerConfigCtr.getAccessToken).mockResolvedValueOnce(null);

      ctr.afterFirstFrame();
      await vi.advanceTimersByTimeAsync(0);

      expect(MockGatewayClient.lastInstance).toBeNull();
    });

    it('should create device ID on first launch and persist it', () => {
      mockStoreGet.mockReturnValue(undefined);
      ctr.afterFirstFrame();

      expect(mockStoreSet).toHaveBeenCalledWith('gatewayDeviceId', 'mock-device-uuid');
    });

    it('should reuse persisted device ID', () => {
      mockStoreGet.mockImplementation((key: string) => {
        if (key === 'gatewayEnabled') return true;
        if (key === 'gatewayDeviceId') return 'existing-id';
        return undefined;
      });
      ctr = new GatewayConnectionCtr(mockApp);
      ctr.afterFirstFrame();

      expect(mockStoreSet).not.toHaveBeenCalledWith('gatewayDeviceId', expect.anything());
    });
  });

  // ─── Reconnection ───

  describe('reconnection', () => {
    it('should broadcast reconnecting status when client emits reconnecting', async () => {
      ctr.afterFirstFrame();
      await vi.advanceTimersByTimeAsync(0);
      const client = MockGatewayClient.lastInstance!;
      client.simulateConnected();
      mockBroadcast.mockClear();

      client.simulateReconnecting(1000);

      expect(mockBroadcast).toHaveBeenCalledWith('gatewayConnectionStatusChanged', {
        status: 'reconnecting',
      });
    });
  });

  // ─── Tool Call Routing ───

  describe('tool call routing', () => {
    async function connectAndOpen() {
      ctr.afterFirstFrame();
      await vi.advanceTimersByTimeAsync(0);
      const client = MockGatewayClient.lastInstance!;
      client.simulateConnected();
      return client;
    }

    it.each([
      ['readFile', 'readFile', mockLocalFileCtr],
      ['listFiles', 'listLocalFiles', mockLocalFileCtr],
      ['moveFiles', 'handleMoveFiles', mockLocalFileCtr],
      ['searchFiles', 'handleLocalFilesSearch', mockLocalFileCtr],
      ['writeFile', 'handleWriteFile', mockLocalFileCtr],
      ['editFile', 'handleEditFile', mockLocalFileCtr],
      ['globFiles', 'handleGlobFiles', mockLocalFileCtr],
      ['grepContent', 'handleGrepContent', mockLocalFileCtr],
      ['runCommand', 'handleRunCommand', mockShellCommandCtr],
      ['getCommandOutput', 'handleGetCommandOutput', mockShellCommandCtr],
      ['killCommand', 'handleKillCommand', mockShellCommandCtr],
      // Legacy aliases — older Gateway versions may still send the long form.
      // `renameLocalFile` is kept even though the new surface drops rename.
      ['readLocalFile', 'readFile', mockLocalFileCtr],
      ['listLocalFiles', 'listLocalFiles', mockLocalFileCtr],
      ['writeLocalFile', 'handleWriteFile', mockLocalFileCtr],
      ['renameLocalFile', 'handleRenameFile', mockLocalFileCtr],
    ] as const)('should route %s to %s', async (apiName, methodName, controller) => {
      const client = await connectAndOpen();

      // Each tool's args are domain-shaped (path, file_path, items, etc.).
      // The runtime denormalizes them before calling the controller, so this
      // test only asserts that the *right* controller method runs — see the
      // envelope-shape test below for end-to-end content/state coverage.
      client.simulateToolCallRequest(apiName, { test: 'arg' });
      await vi.advanceTimersByTimeAsync(0);

      expect((controller as any)[methodName]).toHaveBeenCalled();
    });

    it('should send tool_call_response with content + state envelope on success', async () => {
      vi.mocked(mockLocalFileCtr.readFile).mockResolvedValueOnce({
        charCount: 5,
        content: 'hello',
        createdTime: new Date('2024-01-01'),
        filename: 'a.txt',
        fileType: '.txt',
        lineCount: 1,
        loc: [1, 1] as [number, number],
        modifiedTime: new Date('2024-01-01'),
        totalCharCount: 5,
        totalLineCount: 1,
      });
      const client = await connectAndOpen();

      client.simulateToolCallRequest('readFile', { path: '/a.txt' }, 'req-42');
      await vi.advanceTimersByTimeAsync(0);

      // The runtime produces a formatted prompt string for `content` and a
      // structured snapshot for `state`. We only assert envelope shape here
      // — the exact prompt format is owned by the runtime/prompts packages.
      expect(client.sendToolCallResponse).toHaveBeenCalledTimes(1);
      const response = client.sendToolCallResponse.mock.calls[0][0];
      expect(response.requestId).toBe('req-42');
      expect(response.result.success).toBe(true);
      expect(typeof response.result.content).toBe('string');
      expect(response.result.content.length).toBeGreaterThan(0);
      expect(response.result.content).toContain('hello');
      expect(response.result.state).toMatchObject({
        content: 'hello',
        filename: 'a.txt',
        path: '/a.txt',
      });
    });

    it('should send tool_call_response with error on failure', async () => {
      vi.mocked(mockLocalFileCtr.readFile).mockRejectedValueOnce(new Error('File not found'));
      const client = await connectAndOpen();

      client.simulateToolCallRequest('readFile', { path: '/missing' }, 'req-err');
      await vi.advanceTimersByTimeAsync(0);

      expect(client.sendToolCallResponse).toHaveBeenCalledWith({
        requestId: 'req-err',
        result: {
          content: 'File not found',
          error: 'File not found',
          success: false,
        },
      });
    });

    it('should send error for unknown apiName', async () => {
      const client = await connectAndOpen();

      client.simulateToolCallRequest('unknownApi', {}, 'req-unknown');
      await vi.advanceTimersByTimeAsync(0);

      const errorMsg =
        'Tool "unknownApi" is not available on this device. It may not be supported in the current desktop version. Please skip this tool and try alternative approaches.';
      expect(client.sendToolCallResponse).toHaveBeenCalledWith({
        requestId: 'req-unknown',
        result: {
          content: errorMsg,
          error: errorMsg,
          success: false,
        },
      });
    });

    it('should route tunneled stdio MCP calls to McpCtr.runStdioMcpTool', async () => {
      const client = await connectAndOpen();

      client.simulateMcpCallRequest(
        'getStock',
        { symbol: 'AAPL' },
        { args: ['stock-mcp'], command: 'npx', env: { TOKEN: 'secret' }, name: 'kimi-datasource' },
      );
      await vi.advanceTimersByTimeAsync(0);

      // The builtin local-system switch is keyed on apiName and would reject
      // 'getStock'; the `type: 'mcp'` discriminator routes to the MCP client.
      expect(mockMcpCtr.runStdioMcpTool).toHaveBeenCalledWith({
        args: '{"symbol":"AAPL"}',
        env: { TOKEN: 'secret' },
        params: { args: ['stock-mcp'], command: 'npx', name: 'kimi-datasource' },
        toolName: 'getStock',
      });
    });

    it('should NOT route to MCP when params are present but type is not mcp', async () => {
      // Regression: routing must follow the explicit `type` discriminator, not
      // the mere presence of `params`. A builtin call that happens to carry a
      // `params` field must still go to the builtin switch.
      const client = await connectAndOpen();

      client.emit('tool_call_request', {
        requestId: 'tool-with-params',
        toolCall: {
          apiName: 'readFile',
          arguments: JSON.stringify({ path: '/a.txt' }),
          identifier: 'lobe-local-system',
          params: { args: [], command: 'npx', name: 'x' },
          type: 'tool',
        },
        type: 'tool_call_request',
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(mockMcpCtr.runStdioMcpTool).not.toHaveBeenCalled();
      expect(mockLocalFileCtr.readFile).toHaveBeenCalled();
    });

    it('should send tool_call_response envelope for a successful MCP call', async () => {
      vi.mocked(mockMcpCtr.runStdioMcpTool).mockResolvedValueOnce({
        content: 'stock: 100',
        state: { rows: 1 },
        success: true,
      });
      const client = await connectAndOpen();

      client.simulateMcpCallRequest(
        'getStock',
        {},
        { args: [], command: 'npx', name: 'kimi-datasource' },
        'mcp-ok',
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(client.sendToolCallResponse).toHaveBeenCalledWith({
        requestId: 'mcp-ok',
        result: { content: 'stock: 100', state: { rows: 1 }, success: true },
      });
    });

    it('should send error response when the MCP call throws', async () => {
      vi.mocked(mockMcpCtr.runStdioMcpTool).mockRejectedValueOnce(new Error('spawn ENOENT'));
      const client = await connectAndOpen();

      client.simulateMcpCallRequest(
        'getStock',
        {},
        { args: [], command: 'missing-bin', name: 'kimi-datasource' },
        'mcp-err',
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(client.sendToolCallResponse).toHaveBeenCalledWith({
        requestId: 'mcp-err',
        result: { content: 'spawn ENOENT', error: 'spawn ENOENT', success: false },
      });
    });
  });

  describe('message API routing', () => {
    async function connectAndOpen() {
      ctr.afterFirstFrame();
      await vi.advanceTimersByTimeAsync(0);
      const client = MockGatewayClient.lastInstance!;
      client.simulateConnected();
      return client;
    }

    it('should route iMessage message API requests to the iMessage bridge service', async () => {
      vi.mocked(mockImessageBridgeSrv.handleGatewayMessageApi).mockResolvedValueOnce({
        guid: 'sent-1',
      });
      const client = await connectAndOpen();

      client.simulateMessageApiRequest(
        'imessage',
        'sendText',
        {
          applicationId: 'home-mac-mini',
          chatGuid: 'iMessage;-;chat-1',
          message: 'hello',
        },
        'msg-req-42',
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(mockImessageBridgeSrv.handleGatewayMessageApi).toHaveBeenCalledWith('sendText', {
        applicationId: 'home-mac-mini',
        chatGuid: 'iMessage;-;chat-1',
        message: 'hello',
      });
      expect(client.sendMessageApiResponse).toHaveBeenCalledWith({
        requestId: 'msg-req-42',
        result: {
          content: JSON.stringify({ guid: 'sent-1' }),
          success: true,
        },
      });
    });

    it('should send message_api_response with error for unsupported platforms', async () => {
      const client = await connectAndOpen();

      client.simulateMessageApiRequest('unsupported', 'sendText', {}, 'msg-req-err');
      await vi.advanceTimersByTimeAsync(0);

      const errorMsg =
        'Message API "unsupported/sendText" is not available on this device. It may not be supported in the current desktop version.';
      expect(client.sendMessageApiResponse).toHaveBeenCalledWith({
        requestId: 'msg-req-err',
        result: {
          content: errorMsg,
          error: errorMsg,
          success: false,
        },
      });
    });
  });

  // ─── Auth Expired ───

  describe('auth_expired handling', () => {
    it('should refresh token and reconnect on auth_expired', async () => {
      ctr.afterFirstFrame();
      await vi.advanceTimersByTimeAsync(0);
      const client1 = MockGatewayClient.lastInstance!;
      client1.simulateConnected();

      client1.simulateAuthExpired();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockRemoteServerConfigCtr.refreshAccessToken).toHaveBeenCalled();
      // Should have created a new GatewayClient for reconnection
      expect(MockGatewayClient.lastInstance).not.toBe(client1);
      expect(MockGatewayClient.lastInstance!.connect).toHaveBeenCalled();
    });

    it('should set status to disconnected when token refresh fails', async () => {
      vi.mocked(mockRemoteServerConfigCtr.refreshAccessToken).mockResolvedValueOnce({
        error: 'invalid_grant',
        success: false,
      });

      ctr.afterFirstFrame();
      await vi.advanceTimersByTimeAsync(0);
      const client = MockGatewayClient.lastInstance!;
      client.simulateConnected();
      mockBroadcast.mockClear();

      client.simulateAuthExpired();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockBroadcast).toHaveBeenCalledWith('gatewayConnectionStatusChanged', {
        status: 'disconnected',
      });
    });
  });

  // ─── Agent Run Routing ───

  describe('agent run routing', () => {
    async function connectAndOpen() {
      ctr.afterFirstFrame();
      await vi.advanceTimersByTimeAsync(0);
      const client = MockGatewayClient.lastInstance!;
      client.simulateConnected();
      return client;
    }

    beforeEach(() => {
      vi.mocked(mockHeterogeneousAgentCtr.cancelLhHeteroExec).mockClear();
      vi.mocked(mockHeterogeneousAgentCtr.spawnLhHeteroExec).mockClear();
    });

    it.each([
      'openclaw',
      'hermes',
      'codex',
      'claude-code',
      'codebuddy',
      'cursor',
      'kimi-code',
      'opencode',
    ] as const)('forwards agentType "%s" to spawnLhHeteroExec', async (agentType) => {
      const client = await connectAndOpen();
      client.simulateAgentRunRequest(agentType);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockHeterogeneousAgentCtr.spawnLhHeteroExec).toHaveBeenCalledWith(
        expect.objectContaining({ agentType }),
      );
    });

    it('forwards cwd and primary/fallback context from the request to spawnLhHeteroExec', async () => {
      const client = await connectAndOpen();
      client.simulateAgentRunRequest('claude-code', 'op-ctx', 'hi', 'mock-jwt', {
        cwd: '/Users/alice/repo',
        resumeFallbackSystemContext: 'RECOVERY CONTEXT',
        systemContext: 'WORKSPACE CONTEXT',
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(mockHeterogeneousAgentCtr.spawnLhHeteroExec).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/Users/alice/repo',
          resumeFallbackSystemContext: 'RECOVERY CONTEXT',
          systemContext: 'WORKSPACE CONTEXT',
        }),
      );
    });

    it('forwards the seeded assistant message id to the hetero launcher', async () => {
      const client = await connectAndOpen();
      client.simulateAgentRunRequest('claude-code', 'op-assistant', 'hi', 'mock-jwt', {
        assistantMessageId: 'asst-1',
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(mockHeterogeneousAgentCtr.spawnLhHeteroExec).toHaveBeenCalledWith(
        expect.objectContaining({ assistantMessageId: 'asst-1' }),
      );
    });

    it('forwards resolved selector args from the request to spawnLhHeteroExec', async () => {
      const client = await connectAndOpen();
      client.simulateAgentRunRequest('claude-code', 'op-args', 'hi', 'mock-jwt', {
        args: ['--model', 'opus', '--effort', 'high'],
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(mockHeterogeneousAgentCtr.spawnLhHeteroExec).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ['--model', 'opus', '--effort', 'high'],
        }),
      );
    });

    it('forwards ingestWorkspaceId to spawnLhHeteroExec as workspaceId', async () => {
      const client = await connectAndOpen();
      client.simulateAgentRunRequest('grok-build', 'op-ws', 'hi', 'mock-jwt', {
        ingestWorkspaceId: 'ws-lobehub',
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(mockHeterogeneousAgentCtr.spawnLhHeteroExec).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'ws-lobehub' }),
      );
    });

    it('sends accepted ack and spawns lh hetero exec', async () => {
      const client = await connectAndOpen();
      client.simulateAgentRunRequest('openclaw', 'op-xyz');
      await vi.advanceTimersByTimeAsync(0);

      expect(client.sendAgentRunAck).toHaveBeenCalledWith({
        operationId: 'op-xyz',
        status: 'accepted',
      });
      expect(mockHeterogeneousAgentCtr.spawnLhHeteroExec).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: 'openclaw',
          // Reuses the device's own session token as the run identity, not the
          // dispatched operation jwt.
          jwt: 'mock-access-token',
          operationId: 'op-xyz',
          prompt: 'hello',
          serverUrl: 'https://server.example.com',
          topicId: 'topic-1',
        }),
      );
    });

    it('reuses the device access token as the run jwt instead of request.jwt', async () => {
      const client = await connectAndOpen();
      client.simulateAgentRunRequest('claude-code', 'op-auth', 'hi', 'dispatched-operation-jwt');
      await vi.advanceTimersByTimeAsync(0);

      expect(mockHeterogeneousAgentCtr.spawnLhHeteroExec).toHaveBeenCalledWith(
        expect.objectContaining({ jwt: 'mock-access-token' }),
      );
    });

    it('falls back to request.jwt when the device has no access token', async () => {
      const client = await connectAndOpen();
      // Set after connect so the auto-connect getAccessToken call isn't the one
      // that returns null — only the executeAgentRun lookup should see no token.
      vi.mocked(mockRemoteServerConfigCtr.getAccessToken).mockResolvedValueOnce(null);
      client.simulateAgentRunRequest(
        'claude-code',
        'op-fallback',
        'hi',
        'dispatched-operation-jwt',
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(mockHeterogeneousAgentCtr.spawnLhHeteroExec).toHaveBeenCalledWith(
        expect.objectContaining({ jwt: 'dispatched-operation-jwt' }),
      );
    });

    it('sends rejected ack when remote server URL is not configured', async () => {
      vi.mocked(mockRemoteServerConfigCtr.getRemoteServerUrl).mockResolvedValueOnce('');

      const client = await connectAndOpen();
      client.simulateAgentRunRequest('openclaw', 'op-fail');
      await vi.advanceTimersByTimeAsync(0);

      expect(client.sendAgentRunAck).toHaveBeenCalledWith({
        operationId: 'op-fail',
        reason: 'Remote server URL not configured',
        status: 'rejected',
      });
      expect(mockHeterogeneousAgentCtr.spawnLhHeteroExec).not.toHaveBeenCalled();
    });

    it('sends rejected ack when spawnLhHeteroExec throws', async () => {
      vi.mocked(mockHeterogeneousAgentCtr.spawnLhHeteroExec).mockImplementationOnce(() => {
        throw new Error('binary not found');
      });

      const client = await connectAndOpen();
      client.simulateAgentRunRequest('openclaw', 'op-fail');
      await vi.advanceTimersByTimeAsync(0);

      expect(client.sendAgentRunAck).toHaveBeenCalledWith({
        operationId: 'op-fail',
        reason: 'binary not found',
        status: 'rejected',
      });
    });

    it('forwards an asynchronous spawn rejection instead of acknowledging accepted', async () => {
      vi.mocked(mockHeterogeneousAgentCtr.spawnLhHeteroExec).mockResolvedValueOnce({
        reason: 'spawn EACCES',
        status: 'rejected',
      });

      const client = await connectAndOpen();
      client.simulateAgentRunRequest('opencode', 'op-spawn-fail');
      await vi.advanceTimersByTimeAsync(0);

      expect(client.sendAgentRunAck).toHaveBeenCalledWith({
        operationId: 'op-spawn-fail',
        reason: 'spawn EACCES',
        status: 'rejected',
      });
    });
  });

  // ─── runHeteroTask ───

  describe('runHeteroTask', () => {
    function makeMockStream() {
      const listeners: Array<(chunk: Buffer) => void> = [];

      return {
        on: vi.fn((_event: string, cb: (chunk: Buffer) => void) => listeners.push(cb)),
        _emit: (content: string) => listeners.forEach((cb) => cb(Buffer.from(content))),
      };
    }

    /** Creates a minimal mock child process returned by spawn(). */
    function makeMockChild(pid = 9999) {
      const listeners: Record<string, Array<(...a: any[]) => void>> = {};
      return {
        on: vi.fn((event: string, cb: (...a: any[]) => void) => {
          listeners[event] = listeners[event] ?? [];
          listeners[event].push(cb);
        }),
        pid,
        stderr: makeMockStream(),
        stdout: makeMockStream(),
        unref: vi.fn(),
        _emit: (event: string, ...args: any[]) => listeners[event]?.forEach((cb) => cb(...args)),
      };
    }

    async function connectAndOpen() {
      ctr.afterFirstFrame();
      await vi.advanceTimersByTimeAsync(0);
      const client = MockGatewayClient.lastInstance!;
      client.simulateConnected();
      return client;
    }

    beforeEach(() => {
      execFileSyncMock.mockReturnValue('/usr/local/bin/lh\n');
      spawnMock.mockReset();
    });

    it('always injects buildNotifyProtocol into the prompt', async () => {
      const child = makeMockChild();
      spawnMock.mockReturnValue(child);

      const client = await connectAndOpen();
      client.simulateToolCallRequest(
        'runHeteroTask',
        {
          agentType: 'openclaw',
          operationId: 'op-1',
          prompt: 'hello',
          taskId: 'task-1',
          topicId: 'topic-1',
        },
        'req-run',
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(spawnMock).toHaveBeenCalledTimes(1);
      const [spawnCommand, spawnArgs, spawnOptions] = spawnMock.mock.calls[0] as [
        string,
        string[],
        { env: NodeJS.ProcessEnv },
      ];
      expect(spawnCommand).toBe('/resolved/bin/openclaw');
      expect(spawnOptions.env.PATH).toBe('/resolved/bin:/usr/bin');
      expect(spawnOptions.env.LOBEHUB_OPERATION_ID).toBe('op-1');
      const messageArg = spawnArgs[spawnArgs.indexOf('--message') + 1];
      expect(messageArg).toContain('hello');
      expect(messageArg).toContain('lh notify');
    });

    it('reports a failed child process as a terminal error', async () => {
      const child = makeMockChild();
      const notifySpy = vi.spyOn(ctr as any, 'sendNotify').mockResolvedValue(undefined);
      spawnMock.mockReturnValue(child);

      await (ctr as any).runHeteroTask({
        agentType: 'openclaw',
        operationId: 'op-failed-child',
        prompt: 'hello',
        taskId: 'task-failed-child',
        topicId: 'topic-failed-child',
      });
      child._emit('close', 1, null);
      await vi.advanceTimersByTimeAsync(0);

      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          done: true,
          error: { message: 'Task failed (exit code: 1)', type: 'HeteroProcessError' },
          operationId: 'op-failed-child',
        }),
      );
    });

    it('reports a signal exit as a cancelled terminal signal', async () => {
      const child = makeMockChild();
      const notifySpy = vi.spyOn(ctr as any, 'sendNotify').mockResolvedValue(undefined);
      spawnMock.mockReturnValue(child);

      await (ctr as any).runHeteroTask({
        agentType: 'openclaw',
        operationId: 'op-cancelled-child',
        prompt: 'hello',
        taskId: 'task-cancelled-child',
        topicId: 'topic-cancelled-child',
      });
      child._emit('close', null, 'SIGINT');
      await vi.advanceTimersByTimeAsync(0);

      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cancelled: true,
          done: true,
          error: undefined,
          operationId: 'op-cancelled-child',
        }),
      );
    });

    it.each([
      {
        environmentAgentId: 'ops-default',
        expectedAgentId: 'researcher',
        platformAgentId: ' researcher ',
      },
      {
        environmentAgentId: 'ops-default',
        expectedAgentId: 'ops-default',
        platformAgentId: undefined,
      },
      {
        environmentAgentId: 'ops-default',
        expectedAgentId: 'ops-default',
        platformAgentId: '   ',
      },
      { environmentAgentId: '', expectedAgentId: 'main', platformAgentId: undefined },
    ])(
      'selects OpenClaw agent $expectedAgentId from platform config before environment fallback',
      async ({ environmentAgentId, expectedAgentId, platformAgentId }) => {
        vi.stubEnv('OPENCLAW_AGENT_ID', environmentAgentId);
        spawnMock.mockReturnValue(makeMockChild());

        const client = await connectAndOpen();
        client.simulateToolCallRequest(
          'runHeteroTask',
          {
            agentType: 'openclaw',
            operationId: 'op-agent-selection',
            platformAgentId,
            prompt: 'hello',
            taskId: 'task-agent-selection',
            topicId: 'topic-agent-selection',
          },
          'req-agent-selection',
        );
        await vi.advanceTimersByTimeAsync(0);

        const [, spawnArgs] = spawnMock.mock.calls[0] as [string, string[]];
        expect(spawnArgs[spawnArgs.indexOf('--agent') + 1]).toBe(expectedAgentId);
      },
    );

    it('kills an existing concurrent openclaw process for the same topicId before spawning', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      const notifySpy = vi.spyOn(ctr as any, 'sendNotify');

      // First task
      const child1 = makeMockChild(1111);
      spawnMock.mockReturnValueOnce(child1);
      const client = await connectAndOpen();
      client.simulateToolCallRequest(
        'runHeteroTask',
        {
          agentType: 'openclaw',
          operationId: 'op-1',
          prompt: 'msg1',
          taskId: 'task-1',
          topicId: 'topic-same',
        },
        'req-1',
      );
      await vi.advanceTimersByTimeAsync(0);

      // Second task for same topicId — should kill task-1's pid first
      const child2 = makeMockChild(2222);
      spawnMock.mockReturnValueOnce(child2);
      client.simulateToolCallRequest(
        'runHeteroTask',
        {
          agentType: 'openclaw',
          operationId: 'op-2',
          prompt: 'msg2',
          taskId: 'task-2',
          topicId: 'topic-same',
        },
        'req-2',
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(killSpy).toHaveBeenCalledWith(-1111, 'SIGTERM');
      expect(spawnMock).toHaveBeenCalledTimes(2);

      // The replaced child may close after the new operation has started. It must
      // neither send a terminal notify for the new operation nor remove its task.
      child1._emit('close', null, 'SIGTERM');
      expect(notifySpy).not.toHaveBeenCalled();

      client.simulateToolCallRequest(
        'cancelHeteroTask',
        { signal: 'SIGINT', taskId: 'task-2' },
        'req-cancel-2',
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(killSpy).toHaveBeenCalledWith(-2222, 'SIGINT');

      killSpy.mockRestore();
    });

    it('isolates concurrent group members that share a topic', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      spawnMock.mockReturnValueOnce(makeMockChild(1111)).mockReturnValueOnce(makeMockChild(2222));

      await (ctr as any).runHeteroTask({
        agentType: 'openclaw',
        operationId: 'op-child-1',
        parentOperationId: 'op-parent',
        prompt: 'member one',
        taskId: 'task-child-1',
        topicId: 'topic-shared',
      });
      await (ctr as any).runHeteroTask({
        agentType: 'openclaw',
        operationId: 'op-child-2',
        parentOperationId: 'op-parent',
        prompt: 'member two',
        taskId: 'task-child-2',
        topicId: 'topic-shared',
      });

      expect(killSpy).not.toHaveBeenCalled();
      const firstArgs = spawnMock.mock.calls[0][1] as string[];
      const secondArgs = spawnMock.mock.calls[1][1] as string[];
      expect(firstArgs[firstArgs.indexOf('--session-id') + 1]).toBe('op-child-1');
      expect(secondArgs[secondArgs.indexOf('--session-id') + 1]).toBe('op-child-2');
      expect((ctr as any).platformTasks.get('task-child-2')).toMatchObject({
        parentOperationId: 'op-parent',
      });

      killSpy.mockRestore();
    });

    it('kills the complete detached process group when cancelling a task', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      const child = makeMockChild(5555);
      spawnMock.mockReturnValue(child);
      const client = await connectAndOpen();
      client.simulateToolCallRequest(
        'runHeteroTask',
        {
          agentType: 'openclaw',
          operationId: 'op-cancel',
          prompt: 'work',
          taskId: 'task-cancel',
          topicId: 'topic-cancel',
        },
        'req-run-cancel',
      );
      await vi.advanceTimersByTimeAsync(0);

      client.simulateToolCallRequest(
        'cancelHeteroTask',
        { signal: 'SIGINT', taskId: 'task-cancel' },
        'req-cancel',
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(killSpy).toHaveBeenCalledWith(-5555, 'SIGINT');

      await vi.advanceTimersByTimeAsync(2000);
      expect(killSpy).toHaveBeenCalledWith(-5555, 'SIGKILL');
      killSpy.mockRestore();
    });

    /**
     * @example Cancelling `op-codex` reaches the registered `lh hetero exec` wrapper.
     */
    it('cancels a device local hetero wrapper before checking platform tasks', async () => {
      vi.mocked(mockHeterogeneousAgentCtr.cancelLhHeteroExec).mockResolvedValueOnce({
        exited: true,
        pid: 7777,
        signal: 'SIGINT',
      });
      const client = await connectAndOpen();

      client.simulateToolCallRequest(
        'cancelHeteroTask',
        { signal: 'SIGINT', taskId: 'op-codex' },
        'req-cancel-codex',
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(mockHeterogeneousAgentCtr.cancelLhHeteroExec).toHaveBeenCalledWith({
        operationId: 'op-codex',
        signal: 'SIGINT',
      });
    });

    it('does not escalate cancellation after the process group is gone', async () => {
      const alive = new Set([5556]);
      const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal?) => {
        const target = typeof pid === 'number' ? Math.abs(pid) : Number(pid);
        if (signal === 0) {
          if (!alive.has(target)) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
          return true;
        }
        if (signal === 'SIGINT' || signal === 'SIGTERM') {
          // Leader exits, but leave group membership to the close handler's cleanup
          // simulation below so the escalation probe can see "gone".
        }
        if (signal === 'SIGKILL') {
          alive.delete(target);
        }
        return true;
      });
      const child = makeMockChild(5556);
      spawnMock.mockReturnValue(child);
      const client = await connectAndOpen();
      client.simulateToolCallRequest(
        'runHeteroTask',
        {
          agentType: 'openclaw',
          operationId: 'op-cancel-exit',
          prompt: 'work',
          taskId: 'task-cancel-exit',
          topicId: 'topic-cancel-exit',
        },
        'req-run-cancel-exit',
      );
      await vi.advanceTimersByTimeAsync(0);

      client.simulateToolCallRequest(
        'cancelHeteroTask',
        { signal: 'SIGINT', taskId: 'task-cancel-exit' },
        'req-cancel-exit',
      );
      await vi.advanceTimersByTimeAsync(0);
      // Whole tree is gone with the leader — escalation must not fire SIGKILL.
      alive.delete(5556);
      child._emit('close', 0, null);
      await vi.advanceTimersByTimeAsync(2000);

      expect(killSpy).toHaveBeenCalledWith(-5556, 'SIGINT');
      expect(killSpy).not.toHaveBeenCalledWith(-5556, 'SIGKILL');
      killSpy.mockRestore();
    });

    it('still escalates when the group leader exits but detached children remain', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      const child = makeMockChild(5557);
      spawnMock.mockReturnValue(child);
      const client = await connectAndOpen();
      client.simulateToolCallRequest(
        'runHeteroTask',
        {
          agentType: 'openclaw',
          operationId: 'op-cancel-orphan',
          prompt: 'work',
          taskId: 'task-cancel-orphan',
          topicId: 'topic-cancel-orphan',
        },
        'req-run-cancel-orphan',
      );
      await vi.advanceTimersByTimeAsync(0);

      client.simulateToolCallRequest(
        'cancelHeteroTask',
        { signal: 'SIGINT', taskId: 'task-cancel-orphan' },
        'req-cancel-orphan',
      );
      await vi.advanceTimersByTimeAsync(0);
      // Leader closed, but process.kill(-pid, 0) still succeeds → orphans remain.
      child._emit('close', null, 'SIGINT');
      await vi.advanceTimersByTimeAsync(2000);

      expect(killSpy).toHaveBeenCalledWith(-5557, 'SIGINT');
      expect(killSpy).toHaveBeenCalledWith(-5557, 'SIGKILL');
      killSpy.mockRestore();
    });

    it('uses taskkill to terminate the full Windows wrapper process tree', () => {
      const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');

      (ctr as any).killPlatformProcessTree(6666, 'SIGINT');

      expect(spawnMock).toHaveBeenCalledWith('taskkill', ['/pid', '6666', '/T', '/F'], {
        stdio: 'ignore',
      });
      platformSpy.mockRestore();
    });

    it('does not kill processes for a different topicId', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      const child1 = makeMockChild(3333);
      spawnMock.mockReturnValueOnce(child1);
      const client = await connectAndOpen();
      client.simulateToolCallRequest(
        'runHeteroTask',
        {
          agentType: 'openclaw',
          operationId: 'op-1',
          prompt: 'a',
          taskId: 'task-a',
          topicId: 'topic-A',
        },
        'req-a',
      );
      await vi.advanceTimersByTimeAsync(0);

      const child2 = makeMockChild(4444);
      spawnMock.mockReturnValueOnce(child2);
      client.simulateToolCallRequest(
        'runHeteroTask',
        {
          agentType: 'openclaw',
          operationId: 'op-2',
          prompt: 'b',
          taskId: 'task-b',
          topicId: 'topic-B',
        },
        'req-b',
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(killSpy).not.toHaveBeenCalled();

      killSpy.mockRestore();
    });

    describe('hermes', () => {
      it('relays stdout intact and saves the final session id from stderr', async () => {
        const child = makeMockChild();
        const notifySpy = vi.spyOn(ctr as any, 'sendNotify').mockResolvedValue(undefined);
        spawnMock.mockReturnValue(child);

        await (ctr as any).runHeteroTask({
          agentType: 'hermes',
          operationId: 'op-hermes-1',
          prompt: 'hello',
          taskId: 'task-hermes-1',
          topicId: 'topic-hermes',
        });

        const [command, , spawnOptions] = spawnMock.mock.calls[0] as [
          string,
          string[],
          { stdio: string[] },
        ];
        expect(command).toBe('/resolved/bin/hermes');
        expect(spawnOptions.stdio).toEqual(['ignore', 'pipe', 'pipe']);

        child.stdout._emit('session_id: part of the final answer\nHello from Hermes\n');
        child.stderr._emit(
          'Restored working directory: /repo\r\nsession_id: session-before-compaction\r\n' +
            'Context compacted\r\nsession_id: session-continuation\r\n',
        );
        child._emit('close', 0, null);
        await vi.advanceTimersByTimeAsync(0);

        expect(notifySpy).toHaveBeenCalledWith(
          expect.objectContaining({
            content: 'session_id: part of the final answer\nHello from Hermes',
            operationId: 'op-hermes-1',
            topicId: 'topic-hermes',
          }),
        );
        expect((ctr as any).hermesSessionMap.get('topic-hermes')).toBe('session-continuation');
      });

      it('resumes the saved session and replaces it with a continuation id', async () => {
        const firstChild = makeMockChild(1001);
        const secondChild = makeMockChild(1002);
        const thirdChild = makeMockChild(1003);
        spawnMock
          .mockReturnValueOnce(firstChild)
          .mockReturnValueOnce(secondChild)
          .mockReturnValueOnce(thirdChild);

        await (ctr as any).runHeteroTask({
          agentType: 'hermes',
          operationId: 'op-1',
          prompt: 'remember this',
          taskId: 'task-1',
          topicId: 'topic-multi-turn',
        });
        firstChild.stderr._emit('session_id: session-a\n');
        firstChild._emit('close', 0, null);

        await (ctr as any).runHeteroTask({
          agentType: 'hermes',
          operationId: 'op-2',
          prompt: 'what did I say?',
          taskId: 'task-2',
          topicId: 'topic-multi-turn',
        });
        expect(spawnMock.mock.calls[1][1]).toEqual([
          'chat',
          '--query',
          'what did I say?',
          '--quiet',
          '--accept-hooks',
          '--resume',
          'session-a',
        ]);

        secondChild.stderr._emit('session_id: session-continuation\n');
        secondChild._emit('close', 0, null);

        await (ctr as any).runHeteroTask({
          agentType: 'hermes',
          operationId: 'op-3',
          prompt: 'continue',
          taskId: 'task-3',
          topicId: 'topic-multi-turn',
        });
        expect(spawnMock.mock.calls[2][1]).toContain('session-continuation');
      });

      it('still relays a successful response when stderr has no session id', async () => {
        const child = makeMockChild();
        const notifySpy = vi.spyOn(ctr as any, 'sendNotify').mockResolvedValue(undefined);
        spawnMock.mockReturnValue(child);

        await (ctr as any).runHeteroTask({
          agentType: 'hermes',
          operationId: 'op-no-session',
          prompt: 'hello',
          taskId: 'task-no-session',
          topicId: 'topic-no-session',
        });
        child.stdout._emit('Successful response\n');
        child.stderr._emit('Provider diagnostic only\n');
        child._emit('close', 0, null);
        await vi.advanceTimersByTimeAsync(0);

        expect(notifySpy).toHaveBeenCalledWith(
          expect.objectContaining({ content: 'Successful response' }),
        );
        expect((ctr as any).hermesSessionMap.has('topic-no-session')).toBe(false);
      });
    });
  });

  // ─── Platform Capability Probing ───

  describe('platform capability probing', () => {
    async function connectAndOpen() {
      ctr.afterFirstFrame();
      await vi.advanceTimersByTimeAsync(0);
      const client = MockGatewayClient.lastInstance!;
      client.simulateConnected();
      return client;
    }

    beforeEach(() => {
      resolveRemotePlatformCommandMock.mockReset();
    });

    it('uses the shared login-shell resolver for capability checks', async () => {
      resolveRemotePlatformCommandMock.mockResolvedValue({
        available: true,
        path: '/login-shell/bin/openclaw',
        resolvedPathEnv: '/login-shell/bin:/usr/bin',
        version: '1.2.3',
      });

      const client = await connectAndOpen();
      client.simulateToolCallRequest(
        'checkPlatformCapability',
        { platform: 'openclaw' },
        'req-cap',
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(client.sendToolCallResponse).toHaveBeenCalledWith({
        requestId: 'req-cap',
        result: {
          content: JSON.stringify({ available: true, version: '1.2.3' }),
          state: { available: true, version: '1.2.3' },
          success: true,
        },
      });
      expect(resolveRemotePlatformCommandMock).toHaveBeenCalledWith('openclaw');
    });

    it('returns available:true when the shared resolver has no version', async () => {
      resolveRemotePlatformCommandMock.mockResolvedValue({
        available: true,
        path: '/login-shell/bin/openclaw',
      });

      const client = await connectAndOpen();
      client.simulateToolCallRequest(
        'checkPlatformCapability',
        { platform: 'openclaw' },
        'req-cap-nover',
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(client.sendToolCallResponse).toHaveBeenCalledWith({
        requestId: 'req-cap-nover',
        result: {
          content: JSON.stringify({ available: true }),
          state: { available: true },
          success: true,
        },
      });
    });

    it('returns available:false when binary is not installed', async () => {
      resolveRemotePlatformCommandMock.mockResolvedValue({
        available: false,
      });

      const client = await connectAndOpen();
      client.simulateToolCallRequest(
        'checkPlatformCapability',
        { platform: 'openclaw' },
        'req-missing',
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(client.sendToolCallResponse).toHaveBeenCalledWith({
        requestId: 'req-missing',
        result: {
          content: JSON.stringify({
            available: false,
            reason: 'openclaw is not installed on this device',
          }),
          state: {
            available: false,
            reason: 'openclaw is not installed on this device',
          },
          success: true,
        },
      });
    });

    it('returns available:false for unknown platform', async () => {
      resolveRemotePlatformCommandMock.mockResolvedValue({
        available: false,
        error: 'Unknown platform: unknownBot',
      });

      const client = await connectAndOpen();
      client.simulateToolCallRequest(
        'checkPlatformCapability',
        { platform: 'unknownBot' },
        'req-unknown-plat',
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(client.sendToolCallResponse).toHaveBeenCalledWith({
        requestId: 'req-unknown-plat',
        result: {
          content: JSON.stringify({ available: false, reason: 'Unknown platform: unknownBot' }),
          state: { available: false, reason: 'Unknown platform: unknownBot' },
          success: true,
        },
      });
    });

    it('getAgentProfile returns empty object', async () => {
      resolveRemotePlatformRuntimeMock.mockResolvedValue({
        available: false,
        error: 'openclaw was not found or failed validation',
      });

      const client = await connectAndOpen();
      client.simulateToolCallRequest('getAgentProfile', { platform: 'openclaw' }, 'req-profile');
      await vi.advanceTimersByTimeAsync(0);

      expect(client.sendToolCallResponse).toHaveBeenCalledWith({
        requestId: 'req-profile',
        result: {
          content: JSON.stringify({}),
          state: {},
          success: true,
        },
      });
      expect(executeRemotePlatformMock).not.toHaveBeenCalled();
    });

    it('uses the shared OpenClaw runtime to load its profile', async () => {
      executeRemotePlatformMock.mockResolvedValueOnce({
        stderr: '',
        stdout: JSON.stringify([
          {
            id: 'main',
            identityEmoji: '🦞',
            identityName: 'Clawd',
            isDefault: true,
          },
        ]),
      });

      const client = await connectAndOpen();
      client.simulateToolCallRequest('getAgentProfile', { platform: 'openclaw' }, 'req-openclaw');
      await vi.advanceTimersByTimeAsync(0);

      expect(resolveRemotePlatformRuntimeMock).toHaveBeenCalledWith('openclaw');
      expect(executeRemotePlatformMock).toHaveBeenCalledWith(['agents', 'list', '--json'], {
        timeout: 5000,
      });
      expect(client.sendToolCallResponse).toHaveBeenCalledWith({
        requestId: 'req-openclaw',
        result: {
          content: JSON.stringify({ avatar: '🦞', title: 'Clawd' }),
          state: { avatar: '🦞', description: undefined, title: 'Clawd' },
          success: true,
        },
      });
    });

    it('uses one shared Hermes runtime to load its profile', async () => {
      executeRemotePlatformMock
        .mockResolvedValueOnce({ stderr: '', stdout: '◆research\n' })
        .mockResolvedValueOnce({ stderr: '', stdout: 'Path: /profiles/research\n' });

      const client = await connectAndOpen();
      client.simulateToolCallRequest('getAgentProfile', { platform: 'hermes' }, 'req-hermes');
      await vi.advanceTimersByTimeAsync(0);

      expect(resolveRemotePlatformRuntimeMock).toHaveBeenCalledWith('hermes');
      expect(executeRemotePlatformMock).toHaveBeenNthCalledWith(1, ['profile', 'list'], {
        timeout: 5000,
      });
      expect(executeRemotePlatformMock).toHaveBeenNthCalledWith(
        2,
        ['profile', 'show', 'research'],
        { timeout: 5000 },
      );
      expect(client.sendToolCallResponse).toHaveBeenCalledWith({
        requestId: 'req-hermes',
        result: {
          content: JSON.stringify({ avatar: '⚡', title: 'research' }),
          state: { avatar: '⚡', description: undefined, title: 'research' },
          success: true,
        },
      });
    });
  });

  // ─── IPC Methods ───

  describe('getConnectionStatus', () => {
    it('should return current status', async () => {
      expect(await ctr.getConnectionStatus()).toEqual({ status: 'disconnected' });

      ctr.afterFirstFrame();
      await vi.advanceTimersByTimeAsync(0);
      expect(await ctr.getConnectionStatus()).toEqual({ status: 'connecting' });

      MockGatewayClient.lastInstance!.simulateConnected();
      expect(await ctr.getConnectionStatus()).toEqual({ status: 'connected' });
    });
  });

  describe('getDeviceInfo', () => {
    it('should return device information', async () => {
      mockStoreGet.mockImplementation((key: string) => {
        if (key === 'gatewayEnabled') return true;
        if (key === 'gatewayDeviceId') return 'my-device';
        return undefined;
      });
      ctr = new GatewayConnectionCtr(mockApp);
      ctr.afterFirstFrame();

      const info = await ctr.getDeviceInfo();
      expect(info).toEqual({
        deviceId: 'my-device',
        hostname: 'mock-hostname',
        platform: process.platform,
      });
    });
  });
});
