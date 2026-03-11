import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayHttpClient } from './http';

describe('GatewayHttpClient', () => {
  let client: GatewayHttpClient;

  beforeEach(() => {
    client = new GatewayHttpClient({
      gatewayUrl: 'https://gateway.test.com',
      serviceToken: 'test-service-token',
    });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetch(response: Partial<Response>) {
    const res = {
      json: vi.fn().mockResolvedValue(response.json ? response.json() : {}),
      ok: response.ok ?? true,
      status: response.status ?? 200,
      text: vi.fn().mockResolvedValue(''),
      ...response,
    };
    // Re-bind json/text if the response object had them
    if ('json' in response && typeof response.json === 'function') {
      res.json = response.json;
    }
    if ('text' in response && typeof response.text === 'function') {
      res.text = response.text;
    }
    vi.mocked(fetch).mockResolvedValue(res as any);
    return res;
  }

  describe('queryDeviceStatus', () => {
    it('should return device status on success', async () => {
      mockFetch({
        json: vi.fn().mockResolvedValue({ deviceCount: 2, online: true }),
        ok: true,
      });

      const result = await client.queryDeviceStatus('user-1');

      expect(result).toEqual({ deviceCount: 2, online: true });
      expect(fetch).toHaveBeenCalledWith(
        'https://gateway.test.com/api/device/status',
        expect.objectContaining({
          body: JSON.stringify({ userId: 'user-1' }),
          headers: {
            'Authorization': 'Bearer test-service-token',
            'Content-Type': 'application/json',
          },
          method: 'POST',
        }),
      );
    });

    it('should return defaults on non-ok response', async () => {
      mockFetch({ ok: false, status: 500 });

      const result = await client.queryDeviceStatus('user-1');

      expect(result).toEqual({ deviceCount: 0, online: false });
    });

    it('should handle missing fields in response', async () => {
      mockFetch({
        json: vi.fn().mockResolvedValue({}),
        ok: true,
      });

      const result = await client.queryDeviceStatus('user-1');

      expect(result).toEqual({ deviceCount: 0, online: false });
    });
  });

  describe('queryDeviceList', () => {
    it('should return device list on success', async () => {
      const devices = [
        { connectedAt: 1000, deviceId: 'd1', hostname: 'host1', platform: 'darwin' },
      ];
      mockFetch({
        json: vi.fn().mockResolvedValue({ devices }),
        ok: true,
      });

      const result = await client.queryDeviceList('user-1');

      expect(result).toEqual(devices);
    });

    it('should return empty array on non-ok response', async () => {
      mockFetch({ ok: false });

      const result = await client.queryDeviceList('user-1');

      expect(result).toEqual([]);
    });

    it('should return empty array when devices is not an array', async () => {
      mockFetch({
        json: vi.fn().mockResolvedValue({ devices: 'not-array' }),
        ok: true,
      });

      const result = await client.queryDeviceList('user-1');

      expect(result).toEqual([]);
    });

    it('should return empty array when devices is missing', async () => {
      mockFetch({
        json: vi.fn().mockResolvedValue({}),
        ok: true,
      });

      const result = await client.queryDeviceList('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('executeToolCall', () => {
    it('should return tool call result on success', async () => {
      mockFetch({
        json: vi.fn().mockResolvedValue({ content: 'file contents', success: true }),
        ok: true,
      });

      const result = await client.executeToolCall(
        { userId: 'user-1' },
        { apiName: 'readFile', arguments: '{}', identifier: 'test' },
      );

      expect(result).toEqual({ content: 'file contents', error: undefined, success: true });
    });

    it('should handle non-string content', async () => {
      mockFetch({
        json: vi.fn().mockResolvedValue({ content: { key: 'value' }, success: true }),
        ok: true,
      });

      const result = await client.executeToolCall(
        { userId: 'user-1' },
        { apiName: 'readFile', arguments: '{}', identifier: 'test' },
      );

      expect(result.content).toBe(JSON.stringify({ key: 'value' }));
    });

    it('should handle null/undefined content', async () => {
      mockFetch({
        json: vi.fn().mockResolvedValue({ success: true }),
        ok: true,
      });

      const result = await client.executeToolCall(
        { userId: 'user-1' },
        { apiName: 'readFile', arguments: '{}', identifier: 'test' },
      );

      // content is undefined, so JSON.stringify(undefined ?? data) -> JSON.stringify(data)
      expect(result.content).toContain('success');
    });

    it('should handle missing success field', async () => {
      mockFetch({
        json: vi.fn().mockResolvedValue({ content: 'ok' }),
        ok: true,
      });

      const result = await client.executeToolCall(
        { userId: 'user-1' },
        { apiName: 'readFile', arguments: '{}', identifier: 'test' },
      );

      expect(result.success).toBe(true);
    });

    it('should handle non-ok response', async () => {
      mockFetch({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('Internal Server Error'),
      });

      const result = await client.executeToolCall(
        { userId: 'user-1' },
        { apiName: 'readFile', arguments: '{}', identifier: 'test' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Internal Server Error');
      expect(result.content).toContain('HTTP 500');
    });

    it('should handle non-ok response with text() failure', async () => {
      mockFetch({
        ok: false,
        status: 500,
        text: vi.fn().mockRejectedValue(new Error('read error')),
      });

      const result = await client.executeToolCall(
        { userId: 'user-1' },
        { apiName: 'readFile', arguments: '{}', identifier: 'test' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('HTTP 500');
    });

    it('should pass optional deviceId and timeout', async () => {
      mockFetch({
        json: vi.fn().mockResolvedValue({ content: 'ok', success: true }),
        ok: true,
      });

      await client.executeToolCall(
        { deviceId: 'device-1', timeout: 5000, userId: 'user-1' },
        { apiName: 'readFile', arguments: '{}', identifier: 'test' },
      );

      expect(fetch).toHaveBeenCalledWith(
        'https://gateway.test.com/api/device/tool-call',
        expect.objectContaining({
          body: expect.stringContaining('"deviceId":"device-1"'),
        }),
      );
    });
  });

  describe('getDeviceSystemInfo', () => {
    it('should return system info on success', async () => {
      const systemInfo = {
        arch: 'x64',
        desktopPath: '/home/test/Desktop',
        documentsPath: '/home/test/Documents',
        downloadsPath: '/home/test/Downloads',
        homePath: '/home/test',
        musicPath: '/home/test/Music',
        picturesPath: '/home/test/Pictures',
        userDataPath: '/home/test/.lobehub',
        videosPath: '/home/test/Videos',
        workingDirectory: '/home/test',
      };
      mockFetch({
        json: vi.fn().mockResolvedValue({ success: true, systemInfo }),
        ok: true,
      });

      const result = await client.getDeviceSystemInfo('user-1', 'device-1');

      expect(result).toEqual({ success: true, systemInfo });
    });

    it('should return failure on non-ok response', async () => {
      mockFetch({ ok: false });

      const result = await client.getDeviceSystemInfo('user-1', 'device-1');

      expect(result).toEqual({ success: false });
    });

    it('should handle missing success field', async () => {
      mockFetch({
        json: vi.fn().mockResolvedValue({}),
        ok: true,
      });

      const result = await client.getDeviceSystemInfo('user-1', 'device-1');

      expect(result.success).toBe(false);
    });
  });
});
