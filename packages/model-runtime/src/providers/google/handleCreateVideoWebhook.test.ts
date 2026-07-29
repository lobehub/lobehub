// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleGoogleVideoWebhook } from './handleCreateVideoWebhook';

const { mockCreateRemoteJWKSet, mockJwtVerify } = vi.hoisted(() => ({
  mockCreateRemoteJWKSet: vi.fn(() => 'jwks'),
  mockJwtVerify: vi.fn(),
}));

vi.mock('jose', () => ({
  createRemoteJWKSet: mockCreateRemoteJWKSet,
  jwtVerify: mockJwtVerify,
}));

const createPayload = (body: unknown, timestamp = Math.floor(Date.now() / 1000).toString()) => ({
  body,
  headers: {
    'webhook-signature': 'signed-jwt',
    'webhook-timestamp': timestamp,
  },
  url: 'https://app.example.com/api/webhooks/video/google?token=secret',
});

describe('handleGoogleVideoWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJwtVerify.mockResolvedValue({});
  });

  it('should verify and normalize an interaction completion event', async () => {
    const result = await handleGoogleVideoWebhook(
      createPayload({
        data: { id: 'interactions/omni-123' },
        type: 'interaction.completed',
      }),
    );

    expect(mockCreateRemoteJWKSet).toHaveBeenCalledWith(
      new URL('https://generativelanguage.googleapis.com/.well-known/jwks.json'),
    );
    expect(mockJwtVerify).toHaveBeenCalledWith('signed-jwt', 'jwks', {
      algorithms: ['RS256'],
    });
    expect(result).toEqual({
      inferenceId: 'interactions/omni-123',
      status: 'completed',
    });
  });

  it('should normalize a video generated event as completed', async () => {
    const result = await handleGoogleVideoWebhook(
      createPayload({
        data: {
          id: 'interactions/omni-video-123',
          output_file_uri: 'https://example.com/video.mp4',
        },
        type: 'video.generated',
      }),
    );

    expect(result).toEqual({
      inferenceId: 'interactions/omni-video-123',
      status: 'completed',
    });
  });

  it('should normalize an interaction failure event', async () => {
    const result = await handleGoogleVideoWebhook(
      createPayload({
        data: {
          error_code: 'SAFETY',
          error_message: 'Video generation was blocked',
          id: 'interactions/omni-failed',
        },
        type: 'interaction.failed',
      }),
    );

    expect(result).toEqual({
      error: 'Video generation was blocked',
      inferenceId: 'interactions/omni-failed',
      status: 'error',
    });
  });

  it('should reject stale webhook deliveries', async () => {
    await expect(
      handleGoogleVideoWebhook(
        createPayload(
          { data: { id: 'interactions/omni-123' }, type: 'interaction.completed' },
          '1',
        ),
      ),
    ).rejects.toThrow('outside the allowed replay window');
  });

  it('should reject unsigned webhook deliveries', async () => {
    await expect(
      handleGoogleVideoWebhook({
        body: { data: { id: 'interactions/omni-123' }, type: 'interaction.completed' },
        headers: { 'webhook-timestamp': Math.floor(Date.now() / 1000).toString() },
      }),
    ).rejects.toThrow('Missing Google webhook signature');
  });
});
