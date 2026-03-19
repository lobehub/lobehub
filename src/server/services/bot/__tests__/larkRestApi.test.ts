import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LarkRestApi } from '../platforms/lark/restApi';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('LarkRestApi', () => {
  let api: LarkRestApi;

  beforeEach(() => {
    vi.clearAllMocks();
    api = new LarkRestApi('app-id', 'app-secret', 'lark');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockAuthSuccess(token = 'tenant-token-abc', expire = 7200) {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ code: 0, expire, tenant_access_token: token }),
      ok: true,
    });
  }

  function mockApiSuccess(data: any = {}) {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ code: 0, data }),
      ok: true,
    });
  }

  function mockApiError(code: number, msg: string) {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ code, msg }),
      ok: true,
    });
  }

  describe('getTenantAccessToken', () => {
    it('should fetch and cache tenant access token', async () => {
      mockAuthSuccess('token-1');

      const token = await api.getTenantAccessToken();

      expect(token).toBe('token-1');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal',
        expect.objectContaining({
          body: JSON.stringify({ app_id: 'app-id', app_secret: 'app-secret' }),
          method: 'POST',
        }),
      );
    });

    it('should return cached token on subsequent calls', async () => {
      mockAuthSuccess('token-1');

      await api.getTenantAccessToken();
      const token2 = await api.getTenantAccessToken();

      expect(token2).toBe('token-1');
      expect(mockFetch).toHaveBeenCalledTimes(1); // Only 1 fetch call
    });

    it('should throw on auth failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      await expect(api.getTenantAccessToken()).rejects.toThrow('Lark auth failed: 401');
    });

    it('should throw on auth logical error', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ code: 10003, msg: 'Invalid app_secret' }),
        ok: true,
      });

      await expect(api.getTenantAccessToken()).rejects.toThrow(
        'Lark auth error: 10003 Invalid app_secret',
      );
    });
  });

  describe('sendMessage', () => {
    it('should send a text message', async () => {
      mockAuthSuccess();
      mockApiSuccess({ message_id: 'om_abc123' });

      const result = await api.sendMessage('oc_chat1', 'Hello');

      expect(result).toEqual({ messageId: 'om_abc123' });

      // Second call should be the actual API call (first is auth)
      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('/im/v1/messages');
      const body = JSON.parse(apiCall[1].body);
      expect(body.receive_id).toBe('oc_chat1');
      expect(body.msg_type).toBe('text');
    });

    it('should truncate text exceeding 4000 characters', async () => {
      mockAuthSuccess();
      mockApiSuccess({ message_id: 'om_1' });

      const longText = 'B'.repeat(5000);
      await api.sendMessage('oc_chat1', longText);

      const apiCall = mockFetch.mock.calls[1];
      const body = JSON.parse(apiCall[1].body);
      const content = JSON.parse(body.content);
      expect(content.text.length).toBe(4000);
      expect(content.text.endsWith('...')).toBe(true);
    });
  });

  describe('editMessage', () => {
    it('should edit a message', async () => {
      mockAuthSuccess();
      mockApiSuccess();

      await api.editMessage('om_abc123', 'Updated text');

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('/im/v1/messages/om_abc123');
      expect(apiCall[1].method).toBe('PUT');
    });
  });

  describe('replyMessage', () => {
    it('should reply to a message', async () => {
      mockAuthSuccess();
      mockApiSuccess({ message_id: 'om_reply1' });

      const result = await api.replyMessage('om_abc123', 'Reply text');

      expect(result).toEqual({ messageId: 'om_reply1' });
      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('/im/v1/messages/om_abc123/reply');
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

      await expect(api.sendMessage('oc_1', 'test')).rejects.toThrow(
        'Lark API POST /im/v1/messages?receive_id_type=chat_id failed: 500',
      );
    });

    it('should throw on API logical error', async () => {
      mockAuthSuccess();
      mockApiError(99991, 'Permission denied');

      await expect(api.sendMessage('oc_1', 'test')).rejects.toThrow(
        'Lark API POST /im/v1/messages?receive_id_type=chat_id failed: 99991 Permission denied',
      );
    });
  });

  describe('feishu variant', () => {
    it('should use feishu API base URL', async () => {
      const feishuApi = new LarkRestApi('app-id', 'app-secret', 'feishu');

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ code: 0, expire: 7200, tenant_access_token: 'feishu-token' }),
        ok: true,
      });

      await feishuApi.getTenantAccessToken();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
        expect.any(Object),
      );
    });
  });
});
