import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TelegramRestApi } from '../platforms/telegram/restApi';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('TelegramRestApi', () => {
  let api: TelegramRestApi;

  beforeEach(() => {
    vi.clearAllMocks();
    api = new TelegramRestApi('bot-token-123');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockSuccessResponse(result: any = {}) {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true, result }),
      ok: true,
    });
  }

  function mockHttpError(status: number, text: string) {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status,
      text: () => Promise.resolve(text),
    });
  }

  function mockLogicalError(errorCode: number, description: string) {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ description, error_code: errorCode, ok: false }),
      ok: true,
    });
  }

  describe('sendMessage', () => {
    it('should send a message and return message_id', async () => {
      mockSuccessResponse({ message_id: 42 });

      const result = await api.sendMessage('chat-1', 'Hello');

      expect(result).toEqual({ message_id: 42 });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.telegram.org/botbot-token-123/sendMessage',
        expect.objectContaining({
          body: expect.stringContaining('"chat_id":"chat-1"'),
          method: 'POST',
        }),
      );
    });

    it('should truncate text exceeding 4096 characters', async () => {
      mockSuccessResponse({ message_id: 1 });

      const longText = 'A'.repeat(5000);
      await api.sendMessage('chat-1', longText);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.text.length).toBe(4096);
      expect(callBody.text.endsWith('...')).toBe(true);
    });
  });

  describe('editMessageText', () => {
    it('should edit a message', async () => {
      mockSuccessResponse();

      await api.editMessageText('chat-1', 99, 'Updated text');

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.chat_id).toBe('chat-1');
      expect(callBody.message_id).toBe(99);
      expect(callBody.text).toBe('Updated text');
    });
  });

  describe('sendChatAction', () => {
    it('should send typing action', async () => {
      mockSuccessResponse();

      await api.sendChatAction('chat-1', 'typing');

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.action).toBe('typing');
    });
  });

  describe('deleteMessage', () => {
    it('should delete a message', async () => {
      mockSuccessResponse();

      await api.deleteMessage('chat-1', 100);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.telegram.org/botbot-token-123/deleteMessage',
        expect.any(Object),
      );
    });
  });

  describe('setMessageReaction', () => {
    it('should set a reaction', async () => {
      mockSuccessResponse();

      await api.setMessageReaction('chat-1', 50, '👀');

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.reaction).toEqual([{ emoji: '👀', type: 'emoji' }]);
    });
  });

  describe('removeMessageReaction', () => {
    it('should remove reaction with empty array', async () => {
      mockSuccessResponse();

      await api.removeMessageReaction('chat-1', 50);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.reaction).toEqual([]);
    });
  });

  describe('error handling', () => {
    it('should throw on HTTP error', async () => {
      mockHttpError(500, 'Internal Server Error');

      await expect(api.sendMessage('chat-1', 'test')).rejects.toThrow(
        'Telegram API sendMessage failed: 500',
      );
    });

    it('should throw on logical error (HTTP 200 with ok: false)', async () => {
      mockLogicalError(400, 'Bad Request: message text is empty');

      await expect(api.sendMessage('chat-1', 'test')).rejects.toThrow(
        'Telegram API sendMessage failed: 400 Bad Request: message text is empty',
      );
    });
  });
});
