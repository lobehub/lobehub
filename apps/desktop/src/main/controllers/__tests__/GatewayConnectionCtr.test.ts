import type { execSync as ExecSyncType } from 'node:child_process';

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

vi.mock('electron-is', () => ({
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

const execSyncMock = vi.hoisted(() => vi.fn());
const execFileSyncMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<{ execSync: typeof ExecSyncType }>();
  return { ...actual, execFileSync: execFileSyncMock, execSync: execSyncMock, spawn: spawnMock };
});

vi.mock('node:os', () => ({
  default: { hostname: vi.fn(() => 'mock-hostname') },
}));

vi.mock('@lobechat/device-gateway-client', () => ({
  GatewayClient: MockGatewayClient,
}));

vi.mock('@/services/imessageBridgeSrv', () => ({
  default: class ImessageBridgeService {},
}));

vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
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
  sendPrompt: vi.fn().mockResolvedValue(undefined),
  spawnLhHeteroExec: vi.fn(),
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
      ctr.afterAppReady();
      await vi.advanceTimersByTimeAsync(0);

      const options = MockGatewayClient.lastOptions;
      expect(options).not.toBeNull();
      expect(options.token).toBe('mock-access-token');
      expect(options.deviceId).toBe('stored-device-id');
      expect(options.gatewayUrl).toBe('https://device-gateway.lobehub.com');
      expect(options.logger).toBeDefined();
    });

    it('should use custom gateway URL from store when set', async () => {
      mockStoreGet.mockImplementation((key: string) => {
        if (key === 'gatewayEnabled') return true;
        if (key === 'gatewayUrl') return 'http://localhost:8787';
        return undefined;
      });

      ctr = new GatewayConnectionCtr(mockApp);
      ctr.afterAppReady();
      await vi.advanceTimersByTimeAsync(0);

      expect(MockGatewayClient.lastOptions.gatewayUrl).toBe('http://localhost:8787');
    });

    it('should return success:false when no access token', async () => {
      // Prevent auto-connect, then set up providers manually
      vi.mocked(mockRemoteServerConfigCtr.isRemoteServerConfigured).mockResolvedValueOnce(false);
      ctr.afterAppReady();
      await vi.advanceTimersByTimeAsync(0);

      vi.mocked(mockRemoteServerConfigCtr.getAccessToken).mockResolvedValueOnce(null);

      const result = await ctr.connect();
      expect(result).toEqual({ error: 'No access token available', success: false });
      expect(MockGatewayClient.lastInstance).toBeNull();
    });

    it('should persist gatewayEnabled=true on connect', async () => {
      vi.mocked(mockRemoteServerConfigCtr.isRemoteServerConfigured).mockResolvedValueOnce(false);
      ctr.afterAppReady();
      await vi.advanceTimersByTimeAsync(0);
      mockStoreSet.mockClear();

      await ctr.connect();
      expect(mockStoreSet).toHaveBeenCalledWith('gatewayEnabled', true);
    });

    it('should no-op when already connected', async () => {
      ctr.afterAppReady();
      await vi.advanceTimersByTimeAsync(0);
      const firstClient = MockGatewayClient.lastInstance;
      firstClient!.simulateConnected();

      const result = await ctr.connect();
      expect(result).toEqual({ success: true });
      // No new client created
      expect(MockGatewayClient.lastInstance).toBe(firstClient);
    });

    it('should broadcast status changes: disconnected → connecting → connected', async () => {
      ctr.afterAppReady();
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
      ctr.afterAppReady();
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
      ctr.afterAppReady();
      await vi.advanceTimersByTimeAsync(0);
      MockGatewayClient.lastInstance!.simulateConnected();
      mockStoreSet.mockClear();

      await ctr.disconnect();
      expect(mockStoreSet).toHaveBeenCalledWith('gatewayEnabled', false);
    });

    it('should not trigger reconnect after intentional disconnect', async () => {
      ctr.afterAppReady();
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

  describe('afterAppReady (auto-connect)', () => {
    it('should auto-connect when server is configured and token exists', async () => {
      ctr.afterAppReady();
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
      ctr.afterAppReady();
      await vi.advanceTimersByTimeAsync(0);

      expect(MockGatewayClient.lastInstance).toBeNull();
    });

    it('should skip auto-connect when remote server not configured', async () => {
      vi.mocked(mockRemoteServerConfigCtr.isRemoteServerConfigured).mockResolvedValueOnce(false);

      ctr.afterAppReady();
      await vi.advanceTimersByTimeAsync(0);

      expect(MockGatewayClient.lastInstance).toBeNull();
    });

    it('should skip auto-connect when no access token', async () => {
      vi.mocked(mockRemoteServerConfigCtr.getAccessToken).mockResolvedValueOnce(null);

      ctr.afterAppReady();
      await vi.advanceTimersByTimeAsync(0);

      expect(MockGatewayClient.lastInstance).toBeNull();
    });

    it('should create device ID on first launch and persist it', () => {
      mockStoreGet.mockReturnValue(undefined);
      ctr.afterAppReady();

      expect(mockStoreSet).toHaveBeenCalledWith('gatewayDeviceId', 'mock-device-uuid');
    });

    it('should reuse persisted device ID', () => {
      mockStoreGet.mockImplementation((key: string) => {
        if (key === 'gatewayEnabled') return true;
        if (key === 'gatewayDeviceId') return 'existing-id';
        return undefined;
      });
      ctr = new GatewayConnectionCtr(mockApp);
      ctr.afterAppReady();

      expect(mockStoreSet).not.toHaveBeenCalledWith('gatewayDeviceId', expect.anything());
    });
  });

  // ─── Reconnection ───

  describe('reconnection', () => {
    it('should broadcast reconnecting status when client emits reconnecting', async () => {
      ctr.afterAppReady();
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
      ctr.afterAppReady();
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
      ctr.afterAppReady();
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
      ctr.afterAppReady();
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

      ctr.afterAppReady();
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
      ctr.afterAppReady();
      await vi.advanceTimersByTimeAsync(0);
      const client = MockGatewayClient.lastInstance!;
      client.simulateConnected();
      return client;
    }

    beforeEach(() => {
      vi.mocked(mockHeterogeneousAgentCtr.spawnLhHeteroExec).mockClear();
    });

    it.each(['openclaw', 'hermes', 'codex', 'claude-code'] as const)(
      'forwards agentType "%s" to spawnLhHeteroExec',
      async (agentType) => {
        const client = await connectAndOpen();
        client.simulateAgentRunRequest(agentType);
        await vi.advanceTimersByTimeAsync(0);

        expect(mockHeterogeneousAgentCtr.spawnLhHeteroExec).toHaveBeenCalledWith(
          expect.objectContaining({ agentType }),
        );
      },
    );

    it('forwards cwd and systemContext from the request to spawnLhHeteroExec', async () => {
      const client = await connectAndOpen();
      client.simulateAgentRunRequest('claude-code', 'op-ctx', 'hi', 'mock-jwt', {
        cwd: '/Users/alice/repo',
        systemContext: 'WORKSPACE CONTEXT',
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(mockHeterogeneousAgentCtr.spawnLhHeteroExec).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/Users/alice/repo',
          systemContext: 'WORKSPACE CONTEXT',
        }),
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
          jwt: 'mock-jwt',
          operationId: 'op-xyz',
          prompt: 'hello',
          serverUrl: 'https://server.example.com',
          topicId: 'topic-1',
        }),
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
  });

  // ─── runHeteroTask ───

  describe('runHeteroTask', () => {
    /** Creates a minimal mock child process returned by spawn(). */
    function makeMockChild(pid = 9999) {
      const listeners: Record<string, Array<(...a: any[]) => void>> = {};
      return {
        on: vi.fn((event: string, cb: (...a: any[]) => void) => {
          listeners[event] = listeners[event] ?? [];
          listeners[event].push(cb);
        }),
        pid,
        unref: vi.fn(),
        _emit: (event: string, ...args: any[]) => listeners[event]?.forEach((cb) => cb(...args)),
      };
    }

    async function connectAndOpen() {
      ctr.afterAppReady();
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
      const [, spawnArgs] = spawnMock.mock.calls[0] as [string, string[]];
      const messageArg = spawnArgs[spawnArgs.indexOf('--message') + 1];
      expect(messageArg).toContain('hello');
      expect(messageArg).toContain('lh notify');
    });

    it('kills an existing concurrent openclaw process for the same topicId before spawning', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

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

      expect(killSpy).toHaveBeenCalledWith(1111, 'SIGTERM');
      expect(spawnMock).toHaveBeenCalledTimes(2);

      killSpy.mockRestore();
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
  });

  // ─── Platform Capability Probing ───

  describe('platform capability probing', () => {
    async function connectAndOpen() {
      ctr.afterAppReady();
      await vi.advanceTimersByTimeAsync(0);
      const client = MockGatewayClient.lastInstance!;
      client.simulateConnected();
      return client;
    }

    beforeEach(() => {
      execSyncMock.mockReset();
    });

    it('returns available:true with version when binary is installed', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.startsWith('which ') || cmd.startsWith('where '))
          return '/usr/local/bin/openclaw\n';
        if (cmd.includes('--version')) return 'openclaw 1.2.3\n';
        return '';
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
          content: JSON.stringify({ available: true, version: 'openclaw 1.2.3' }),
          state: { available: true, version: 'openclaw 1.2.3' },
          success: true,
        },
      });
    });

    it('returns available:true without version when --version command fails', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.startsWith('which ') || cmd.startsWith('where '))
          return '/usr/local/bin/openclaw\n';
        throw new Error('version command failed');
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
      execSyncMock.mockImplementation(() => {
        throw new Error('command not found');
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
    });
  });

  // ─── IPC Methods ───

  describe('getConnectionStatus', () => {
    it('should return current status', async () => {
      expect(await ctr.getConnectionStatus()).toEqual({ status: 'disconnected' });

      ctr.afterAppReady();
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
      ctr.afterAppReady();

      const info = await ctr.getDeviceInfo();
      expect(info).toEqual({
        description: '',
        deviceId: 'my-device',
        hostname: 'mock-hostname',
        name: 'mock-hostname',
        platform: process.platform,
      });
    });
  });
});
