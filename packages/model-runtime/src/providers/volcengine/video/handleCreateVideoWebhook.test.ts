import { describe, expect, it, vi } from 'vitest';

import { handleVolcengineVideoWebhook } from './handleCreateVideoWebhook';

vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

describe('handleVolcengineVideoWebhook', () => {
  describe('intermediate statuses', () => {
    it('should return pending for queued status', async () => {
      const result = await handleVolcengineVideoWebhook({
        body: { status: 'queued' },
      });

      expect(result).toEqual({ status: 'pending' });
    });

    it('should return pending for running status', async () => {
      const result = await handleVolcengineVideoWebhook({
        body: { status: 'running' },
      });

      expect(result).toEqual({ status: 'pending' });
    });
  });

  describe('succeeded', () => {
    it('should return full success result with all fields', async () => {
      const result = await handleVolcengineVideoWebhook({
        body: {
          content: { video_url: 'https://example.com/video.mp4' },
          generate_audio: true,
          id: 'task-123',
          model: 'doubao-video',
          status: 'succeeded',
          usage: { completion_tokens: 1000, total_tokens: 1200 },
        },
      });

      expect(result).toEqual({
        generateAudio: true,
        inferenceId: 'task-123',
        model: 'doubao-video',
        status: 'success',
        usage: { completionTokens: 1000, totalTokens: 1200 },
        videoUrl: 'https://example.com/video.mp4',
      });
    });

    it('should return undefined usage when usage is missing', async () => {
      const result = await handleVolcengineVideoWebhook({
        body: {
          content: { video_url: 'https://example.com/video.mp4' },
          id: 'task-123',
          status: 'succeeded',
        },
      });

      expect(result).toMatchObject({
        inferenceId: 'task-123',
        status: 'success',
        usage: undefined,
        videoUrl: 'https://example.com/video.mp4',
      });
    });

    it('should fallback totalTokens to completionTokens when total_tokens is missing', async () => {
      const result = await handleVolcengineVideoWebhook({
        body: {
          content: { video_url: 'https://example.com/video.mp4' },
          id: 'task-123',
          status: 'succeeded',
          usage: { completion_tokens: 800 },
        },
      });

      expect(result).toMatchObject({
        status: 'success',
        usage: { completionTokens: 800, totalTokens: 800 },
      });
    });

    it('should throw when id is missing on succeeded', async () => {
      await expect(
        handleVolcengineVideoWebhook({
          body: {
            content: { video_url: 'https://example.com/video.mp4' },
            status: 'succeeded',
          },
        }),
      ).rejects.toThrow('Missing task id');
    });

    it('should throw when video_url is missing on succeeded', async () => {
      await expect(
        handleVolcengineVideoWebhook({
          body: {
            content: {},
            id: 'task-123',
            status: 'succeeded',
          },
        }),
      ).rejects.toThrow('Missing video_url');
    });

    it('should throw when content is undefined on succeeded', async () => {
      await expect(
        handleVolcengineVideoWebhook({
          body: {
            id: 'task-123',
            status: 'succeeded',
          },
        }),
      ).rejects.toThrow('Missing video_url');
    });
  });

  describe('error statuses', () => {
    it('should return error message from failed status', async () => {
      const result = await handleVolcengineVideoWebhook({
        body: {
          error: { message: 'Content policy violation' },
          id: 'task-123',
          status: 'failed',
        },
      });

      expect(result).toEqual({
        error: 'Content policy violation',
        inferenceId: 'task-123',
        status: 'error',
      });
    });

    it('should return expired message for expired status', async () => {
      const result = await handleVolcengineVideoWebhook({
        body: {
          id: 'task-123',
          status: 'expired',
        },
      });

      expect(result).toEqual({
        error: 'Video generation task expired',
        inferenceId: 'task-123',
        status: 'error',
      });
    });

    it('should return unknown error for unknown status without error message', async () => {
      const result = await handleVolcengineVideoWebhook({
        body: {
          id: 'task-123',
          status: 'unknown_status',
        },
      });

      expect(result).toEqual({
        error: 'Unknown error',
        inferenceId: 'task-123',
        status: 'error',
      });
    });

    it('should throw when id is missing on failed status', async () => {
      await expect(
        handleVolcengineVideoWebhook({
          body: {
            error: { message: 'some error' },
            status: 'failed',
          },
        }),
      ).rejects.toThrow('Missing task id');
    });
  });
});
