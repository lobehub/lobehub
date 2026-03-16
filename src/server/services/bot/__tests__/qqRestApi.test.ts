import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QQRestApi } from '../platforms/qq/restApi';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('QQRestApi', () => {
  let api: QQRestApi;

  beforeEach(() => {
    vi.clearAllMocks();
    api = new QQRestApi('app-id', 'client-secret');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockAuthSuccess(token = 'qq-access-token', expiresIn = 7200) {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ access_token: token, expires_in: expiresIn }),
      ok: true,
    });
  }

  function mockApiSuccess(data: any = {}) {
    mockFetch.mockResolvedValueOnce({
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(data),
      ok: true,
    });
  }

  describe('getAccessToken', () => {
    it('should fetch and cache access token', async () => {
      mockAuthSuccess('token-1');

      const token = await api.getAccessToken();

      expect(token).toBe('token-1');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://bots.qq.com/app/getAppAccessToken',
        expect.objectContaining({
          body: JSON.stringify({ appId: 'app-id', clientSecret: 'client-secret' }),
          method: 'POST',
        }),
      );
    });

    it('should return cached token on subsequent calls', async () => {
      mockAuthSuccess('token-1');

      await api.getAccessToken();
      const token2 = await api.getAccessToken();

      expect(token2).toBe('token-1');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw on auth failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      await expect(api.getAccessToken()).rejects.toThrow('QQ auth failed: 401');
    });
  });

  describe('sendMessage', () => {
    it('should send group message', async () => {
      mockAuthSuccess();
      mockApiSuccess({ id: 'msg-1' });

      const result = await api.sendMessage('group', 'group-123', 'Hello');

      expect(result).toEqual({ id: 'msg-1' });

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toBe('https://api.sgroup.qq.com/v2/groups/group-123/messages');
      expect(apiCall[1].headers.Authorization).toBe('QQBot qq-access-token');
    });

    it('should send guild channel message', async () => {
      mockAuthSuccess();
      mockApiSuccess({ id: 'msg-2' });

      await api.sendMessage('guild', 'channel-456', 'Hello');

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toBe('https://api.sgroup.qq.com/channels/channel-456/messages');
    });

    it('should send c2c message', async () => {
      mockAuthSuccess();
      mockApiSuccess({ id: 'msg-3' });

      await api.sendMessage('c2c', 'user-789', 'Hello');

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toBe('https://api.sgroup.qq.com/v2/users/user-789/messages');
    });

    it('should send dms message', async () => {
      mockAuthSuccess();
      mockApiSuccess({ id: 'msg-4' });

      await api.sendMessage('dms', 'guild-abc', 'Hello');

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toBe('https://api.sgroup.qq.com/dms/guild-abc/messages');
    });

    it('should truncate text exceeding 2000 characters', async () => {
      mockAuthSuccess();
      mockApiSuccess({ id: 'msg-5' });

      const longText = 'A'.repeat(3000);
      await api.sendMessage('group', 'group-123', longText);

      const apiCall = mockFetch.mock.calls[1];
      const body = JSON.parse(apiCall[1].body);
      expect(body.content.length).toBe(2000);
      expect(body.content.endsWith('...')).toBe(true);
    });
  });

  describe('sendAsEdit', () => {
    it('should send a new message as fallback (QQ has no edit support)', async () => {
      mockAuthSuccess();
      mockApiSuccess({ id: 'msg-new' });

      const result = await api.sendAsEdit('group', 'group-123', 'Updated content');

      expect(result).toEqual({ id: 'msg-new' });
    });
  });

  describe('error handling', () => {
    it('should throw on API HTTP error', async () => {
      mockAuthSuccess();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server Error'),
      });

      await expect(api.sendMessage('group', 'g-1', 'test')).rejects.toThrow(
        'QQ API POST /v2/groups/g-1/messages failed: 500',
      );
    });
  });
});
