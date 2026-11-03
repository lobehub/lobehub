import { BrowserIdentifier, BrowserManifest } from '@lobechat/builtin-tool-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ToolExecutionContext } from '../../types';

const mockExecuteToolCall = vi.fn();
vi.mock('@/server/services/deviceGateway/authorizedToolCall', () => ({
  executeAuthorizedDeviceToolCall: (_serverDB: unknown, ...args: unknown[]) =>
    mockExecuteToolCall(...args),
}));

const mockQueryDeviceList = vi.fn();
const mockReadDeviceSystemInfo = vi.fn();
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    queryDeviceList: (...args: unknown[]) => mockQueryDeviceList(...args),
    readDeviceSystemInfo: (...args: unknown[]) => mockReadDeviceSystemInfo(...args),
  },
}));

const mockUploadBase64 = vi.fn();
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return { uploadBase64: mockUploadBase64 };
  }),
}));

// Import after mock setup
const { browserRuntime } = await import('../browser');

/** Minimal drizzle chain for the live personal agent used by these tests. */
const personalAgentServerDB = {
  select: () => ({
    from: () => ({
      where: () => ({ limit: () => Promise.resolve([{ workspaceId: null }]) }),
    }),
  }),
} as any;

describe('browserRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryDeviceList.mockResolvedValue([]);
    mockReadDeviceSystemInfo.mockResolvedValue({ ok: true, systemInfo: {} });
  });

  describe('device client kind', () => {
    const context = {
      activeDeviceId: 'vm-cli',
      agentId: 'agt-1',
      operationId: 'op-1',
      serverDB: personalAgentServerDB,
      toolManifestMap: {},
      topicId: 'tpc-1',
      userId: 'user-1',
    } as ToolExecutionContext;

    // A CLI without agent-browser has no browser; dispatching there answered
    // `Unknown tool API: navigate`, which left agents retrying blind after
    // activating a CLI-only device (agent vent reports).
    it('does not dispatch to a CLI-only device that does not offer the browser', async () => {
      mockQueryDeviceList.mockResolvedValue([
        {
          channels: [{ channel: 'cli', connectedAt: 1, connectionId: 'c1' }],
          deviceId: 'vm-cli',
          hostname: 'VM-6-135-ubuntu',
          platform: 'linux',
        },
      ]);

      const runtime = browserRuntime.factory(context);
      const result = await runtime.navigate({ url: 'https://example.com' });

      expect(mockExecuteToolCall).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error.code).toBe('BROWSER_DEVICE_UNSUPPORTED');
      expect(result.content).toContain('lh connect');
      expect(result.content).toContain('agent-browser');
      expect(mockReadDeviceSystemInfo).toHaveBeenCalledWith('user-1', 'vm-cli', undefined, {
        clientKinds: ['cli'],
      });
      // lobe-web-browsing is not in this run's tool set, so it must not be offered.
      expect(result.content).not.toContain('lobe-web-browsing');
    });

    it('points at lobe-web-browsing only when the run can call it', async () => {
      mockQueryDeviceList.mockResolvedValue([
        { channels: [{ channel: 'cli', connectedAt: 1, connectionId: 'c1' }], deviceId: 'vm-cli' },
      ]);

      const runtime = browserRuntime.factory({
        ...context,
        toolManifestMap: { 'lobe-web-browsing': {} as any },
      });
      const result = await runtime.navigate({ url: 'https://example.com' });

      expect(result.error.code).toBe('BROWSER_DEVICE_UNSUPPORTED');
      expect(result.content).toContain('use lobe-web-browsing (search / crawl) instead');
    });

    it('dispatches to the CLI when it lists the browser in supportedTools', async () => {
      mockQueryDeviceList.mockResolvedValue([
        { channels: [{ channel: 'cli', connectedAt: 1, connectionId: 'c1' }], deviceId: 'vm-cli' },
      ]);
      mockReadDeviceSystemInfo.mockResolvedValue({
        ok: true,
        systemInfo: { supportedTools: [BrowserIdentifier] },
      });
      mockExecuteToolCall.mockResolvedValue({ content: 'ok', success: true });

      const runtime = browserRuntime.factory(context);
      await runtime.navigate({ url: 'https://example.com' });
      await runtime.snapshot({});

      expect(mockExecuteToolCall).toHaveBeenCalledTimes(2);
      expect(mockExecuteToolCall.mock.calls[0][0]).toMatchObject({ clientKinds: ['cli'] });
      // The target is resolved once per runtime, not per call.
      expect(mockReadDeviceSystemInfo).toHaveBeenCalledTimes(1);
    });

    // A timed-out capability read was cached as "unsupported", so a CLI with
    // agent-browser installed got install guidance for the rest of the run.
    it('does not treat an unanswered capability read as missing support', async () => {
      mockQueryDeviceList.mockResolvedValue([
        { channels: [{ channel: 'cli', connectedAt: 1, connectionId: 'c1' }], deviceId: 'vm-cli' },
      ]);
      mockReadDeviceSystemInfo
        .mockResolvedValueOnce({ ok: false, reason: 'TIMEOUT' })
        .mockResolvedValueOnce({ ok: true, systemInfo: { supportedTools: [BrowserIdentifier] } });
      mockExecuteToolCall.mockResolvedValue({ content: 'ok', success: true });

      const runtime = browserRuntime.factory(context);
      const first = await runtime.navigate({ url: 'https://example.com' });

      expect(first.success).toBe(false);
      expect(first.error.code).toBe('BROWSER_DEVICE_UNVERIFIED');
      expect(first.content).toContain('TIMEOUT');
      expect(first.content).not.toContain('install agent-browser');
      expect(mockExecuteToolCall).not.toHaveBeenCalled();

      const second = await runtime.navigate({ url: 'https://example.com' });

      expect(second.success).toBe(true);
      expect(mockExecuteToolCall.mock.calls[0][0]).toMatchObject({ clientKinds: ['cli'] });
    });

    it('dispatches to the desktop app when the device also has one', async () => {
      mockQueryDeviceList.mockResolvedValue([
        {
          channels: [
            { channel: 'cli', connectedAt: 1, connectionId: 'c1' },
            { channel: 'desktop', connectedAt: 2, connectionId: 'd1' },
          ],
          deviceId: 'vm-cli',
          hostname: 'mac',
          platform: 'darwin',
        },
      ]);
      mockExecuteToolCall.mockResolvedValue({ content: 'ok', success: true });

      const runtime = browserRuntime.factory(context);
      const result = await runtime.navigate({ url: 'https://example.com' });

      expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
      // Both clients can serve lobe-browser now; the desktop's panel wins.
      expect(mockExecuteToolCall.mock.calls[0][0]).toMatchObject({ clientKinds: ['desktop'] });
      expect(mockReadDeviceSystemInfo).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('keeps dispatching when the device presence is unknown', async () => {
      mockQueryDeviceList.mockRejectedValue(new Error('gateway down'));
      mockExecuteToolCall.mockResolvedValue({ content: 'ok', success: true });

      const runtime = browserRuntime.factory(context);
      await runtime.navigate({ url: 'https://example.com' });

      expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
    });
  });

  describe('screenshot', () => {
    const screenshotContext = {
      activeDeviceId: 'device-1',
      agentId: 'agt-1',
      operationId: 'op-1',
      serverDB: personalAgentServerDB,
      toolManifestMap: {},
      topicId: 'tpc-1',
      userId: 'user-1',
    } as ToolExecutionContext;

    it('stores the capture as a file and exposes it on state.images', async () => {
      // The heterogeneous pipeline already uploads a tool_result image and
      // rewrites it to { fileId, url }. Proxying the device dataUrl verbatim
      // left this runtime as the only image-producing tool with no file behind
      // it — the model could not see its own screenshot and nothing downstream
      // had an id to cite.
      mockExecuteToolCall.mockResolvedValue({
        content: '',
        state: { dataUrl: 'data:image/jpeg;base64,QUJD', height: 100, width: 200 },
        success: true,
      });
      mockUploadBase64.mockResolvedValue({
        fileId: 'file_1',
        key: 'k',
        url: 'https://cdn.example.com/shot.jpeg',
      });

      const runtime = browserRuntime.factory(screenshotContext);
      const result = await runtime.screenshot({});

      expect(mockUploadBase64).toHaveBeenCalledWith(
        'QUJD',
        expect.stringMatching(/^files\/\d{4}-\d{2}-\d{2}\/browser-screenshot-\d+\.jpg$/),
        { fileType: 'image/jpeg' },
      );
      // `state` reaches the model as image parts, not text, so the id has to be
      // named in `content` or a builder can see the shot without being able to
      // cite it.
      expect(result.content).toContain('file_1');
      expect(result.state).toEqual({
        height: 100,
        images: [
          { fileId: 'file_1', mediaType: 'image/jpeg', url: 'https://cdn.example.com/shot.jpeg' },
        ],
        // `dataUrl` was both the model's copy and the chat renderer's src, so
        // dropping it without a replacement blanked every proxied screenshot.
        url: 'https://cdn.example.com/shot.jpeg',
        width: 200,
      });
      // The base64 must not survive into the persisted tool state.
      expect(result.state.dataUrl).toBeUndefined();
    });

    it('passes the capture through unchanged when the upload fails', async () => {
      mockExecuteToolCall.mockResolvedValue({
        content: '',
        state: { dataUrl: 'data:image/jpeg;base64,QUJD' },
        success: true,
      });
      mockUploadBase64.mockRejectedValue(new Error('s3 down'));

      const runtime = browserRuntime.factory(screenshotContext);
      const result = await runtime.screenshot({});

      expect(result.state).toEqual({ dataUrl: 'data:image/jpeg;base64,QUJD' });
    });

    it('does not upload a stale dataUrl from a failed capture', async () => {
      mockExecuteToolCall.mockResolvedValue({
        content: 'Browser action failed',
        state: { dataUrl: 'data:image/jpeg;base64,QUJD' },
        success: false,
      });

      const runtime = browserRuntime.factory(screenshotContext);
      const result = await runtime.screenshot({});

      expect(mockUploadBase64).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    it('leaves non-screenshot apis untouched', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: 'OK', success: true });

      const runtime = browserRuntime.factory(screenshotContext);
      await runtime.navigate({ url: 'https://example.com' });

      expect(mockUploadBase64).not.toHaveBeenCalled();
    });
  });

  it('should have the correct identifier', () => {
    expect(browserRuntime.identifier).toBe(BrowserIdentifier);
  });

  describe('factory', () => {
    it('should throw when userId is missing', () => {
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-1',
        toolManifestMap: {},
      };

      expect(() => browserRuntime.factory(context)).toThrow(
        'userId is required for Browser device proxy execution',
      );
    });

    it('should throw when agentId is missing', () => {
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-1',
        toolManifestMap: {},
        userId: 'user-1',
      };

      expect(() => browserRuntime.factory(context)).toThrow(
        'agentId is required for Browser device proxy execution',
      );
    });

    it('should return a structured NO_ACTIVE_DEVICE result per API when activeDeviceId is missing', async () => {
      const context: ToolExecutionContext = {
        agentId: 'agt-1',
        // Device-unrouted run WITH the picker still advertised: recovery via
        // lobe-remote-device activation is possible.
        toolManifestMap: { 'lobe-remote-device': {} as any },
        userId: 'user-1',
      };

      const proxy = browserRuntime.factory(context) as Record<string, (args: any) => Promise<any>>;

      // Every manifest API is present (not a throw), and each returns the
      // structured, recoverable error instead of an opaque failure.
      for (const api of BrowserManifest.api) {
        expect(proxy[api.name]).toBeDefined();
        expect(typeof proxy[api.name]).toBe('function');
      }

      const result = await proxy[BrowserManifest.api[0].name]({ url: 'https://example.com' });

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({ code: 'NO_ACTIVE_DEVICE' });
      expect(result.content).toContain('lobe-remote-device.listOnlineDevices');
      expect(result.content).toContain('activateDevice');
      expect(result.content).toContain('desktop application or cli');
      // No device dispatch happened.
      expect(mockExecuteToolCall).not.toHaveBeenCalled();
    });

    it('should point at user reconnection when the remote-device picker is not in the manifest', async () => {
      const context: ToolExecutionContext = {
        agentId: 'agt-1',
        toolManifestMap: {
          'lobe-browser': {} as any,
        },
        userId: 'user-1',
      };

      const proxy = browserRuntime.factory(context) as Record<string, (args: any) => Promise<any>>;
      const result = await proxy[BrowserManifest.api[0].name]({});

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({ code: 'NO_ACTIVE_DEVICE' });
      expect(result.content).toContain('locked to a specific device');
      expect(result.content).not.toContain('activateDevice');
    });

    it('should create a proxy with a function for each API in BrowserManifest when a device is active', () => {
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-1',
        agentId: 'agt-1',
        topicId: 'tpc-1',
        toolManifestMap: {},
        userId: 'user-1',
      };

      const proxy = browserRuntime.factory(context) as Record<string, () => any>;

      for (const api of BrowserManifest.api) {
        expect(proxy[api.name]).toBeDefined();
        expect(typeof proxy[api.name]).toBe('function');
      }
    });
  });
});
