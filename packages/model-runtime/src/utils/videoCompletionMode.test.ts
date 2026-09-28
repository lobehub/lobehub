import { describe, expect, it, vi } from 'vitest';

import {
  createVideoWithCompletionMode,
  prepareVideoPayload,
  resolveVideoCompletionMode,
} from './videoCompletionMode';

describe('resolveVideoCompletionMode', () => {
  it('should default dual-mode models to polling', () => {
    expect(
      resolveVideoCompletionMode({
        callbackUrl: 'https://example.com/webhook',
        capabilities: { completionModes: ['polling', 'webhook'] },
      }),
    ).toBe('polling');
  });

  it('should honor the webhook preference when a callback URL is available', () => {
    expect(
      resolveVideoCompletionMode({
        callbackUrl: 'https://example.com/webhook',
        capabilities: { completionModes: ['polling', 'webhook'] },
        preferredCompletionMode: 'webhook',
      }),
    ).toBe('webhook');
  });

  it('should use the only supported mode when it differs from the preference', () => {
    expect(
      resolveVideoCompletionMode({
        callbackUrl: 'https://example.com/webhook',
        capabilities: { completionModes: ['webhook'] },
        preferredCompletionMode: 'polling',
      }),
    ).toBe('webhook');
  });

  it('should fall back to polling when webhook has no callback URL', () => {
    expect(
      resolveVideoCompletionMode({
        capabilities: { completionModes: ['polling', 'webhook'] },
        preferredCompletionMode: 'webhook',
      }),
    ).toBe('polling');
  });

  it('should reject webhook-only runtimes without a callback URL', () => {
    expect(() =>
      resolveVideoCompletionMode({
        capabilities: { completionModes: ['webhook'] },
      }),
    ).toThrow('Video generation requires a webhook callback URL');
  });
});

describe('prepareVideoPayload', () => {
  const payload = {
    callbackUrl: 'https://example.com/webhook',
    model: 'video-model',
    params: { prompt: 'A cat' },
  };

  it('should remove the callback URL from polling requests', () => {
    expect(prepareVideoPayload(payload, 'polling')).toEqual({
      model: 'video-model',
      params: { prompt: 'A cat' },
    });
  });

  it('should preserve the callback URL for webhook requests', () => {
    expect(prepareVideoPayload(payload, 'webhook')).toBe(payload);
  });
});

describe('createVideoWithCompletionMode', () => {
  it('should resolve and execute a single completion mode for a provider runtime', async () => {
    const createVideo = vi.fn().mockResolvedValue({ inferenceId: 'video-1' });
    const runtime = {
      createVideo,
      getVideoGenerationCapabilities: () => ({
        completionModes: ['polling', 'webhook'] as const,
      }),
    };

    await expect(
      createVideoWithCompletionMode(
        runtime,
        {
          callbackUrl: 'https://example.com/webhook',
          model: 'video-model',
          params: { prompt: 'A cat' },
        },
        { preferredCompletionMode: 'webhook' },
      ),
    ).resolves.toEqual({
      completionMode: 'webhook',
      inferenceId: 'video-1',
    });
    expect(createVideo).toHaveBeenCalledOnce();
  });
});
