// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleGoogleVideoWebhook } from './handleCreateVideoWebhook';

const signingKeys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const publicJwk = await crypto.subtle.exportKey('jwk', signingKeys.publicKey);

const toBase64 = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

const sign = async (content: string, key: CryptoKey = signingKeys.privateKey) =>
  toBase64(await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(content)));

/** Builds a delivery signed the way Gemini signs dynamic webhooks (Standard Webhooks `v1a`). */
const createPayload = async (
  body: unknown,
  {
    signingKey,
    timestamp = Math.floor(Date.now() / 1000).toString(),
  }: { signingKey?: CryptoKey; timestamp?: string } = {},
) => {
  const rawBody = JSON.stringify(body);
  const webhookId = 'msg_test';

  return {
    body,
    headers: {
      'webhook-id': webhookId,
      'webhook-signature': `v1a,${await sign(`${webhookId}.${timestamp}.${rawBody}`, signingKey)}`,
      'webhook-timestamp': timestamp,
    },
    rawBody,
    url: 'https://app.example.com/api/webhooks/video/google?token=secret',
  };
};

describe('handleGoogleVideoWebhook', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ ...publicJwk, alg: 'EdDSA', use: 'sig' }] })),
    );
  });

  it('should verify and normalize an interaction completion event', async () => {
    const result = await handleGoogleVideoWebhook(
      await createPayload({
        data: { id: 'interactions/omni-123' },
        type: 'interaction.completed',
      }),
    );

    expect(result).toEqual({
      inferenceId: 'interactions/omni-123',
      status: 'completed',
    });
  });

  it('should normalize a video generated event as completed', async () => {
    const result = await handleGoogleVideoWebhook(
      await createPayload({
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
      await createPayload({
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
        await createPayload(
          { data: { id: 'interactions/omni-123' }, type: 'interaction.completed' },
          { timestamp: '1' },
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
  it('should reject a delivery signed with an unknown key', async () => {
    const otherKeys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ]);

    await expect(
      handleGoogleVideoWebhook(
        await createPayload(
          { data: { id: 'interactions/omni-123' }, type: 'interaction.completed' },
          { signingKey: otherKeys.privateKey },
        ),
      ),
    ).rejects.toThrow('Invalid Google webhook signature');
  });

  it('should reject a delivery whose body was changed after signing', async () => {
    const payload = await createPayload({
      data: { id: 'interactions/omni-123' },
      type: 'interaction.completed',
    });

    await expect(
      handleGoogleVideoWebhook({
        ...payload,
        rawBody: payload.rawBody.replace('omni-123', 'omni-456'),
      }),
    ).rejects.toThrow('Invalid Google webhook signature');
  });

  describe('key refresh', () => {
    const jwksResponse = (jwk: JsonWebKey) =>
      new Response(JSON.stringify({ keys: [{ ...jwk, alg: 'EdDSA', use: 'sig' }] }));

    /** Loads a fresh module instance so the module-level JWKS cache starts empty. */
    const loadHandler = async () => {
      vi.resetModules();
      return (await import('./handleCreateVideoWebhook')).handleGoogleVideoWebhook;
    };

    const completedBody = { data: { id: 'interactions/omni-123' }, type: 'interaction.completed' };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      return () => vi.useRealTimers();
    });

    it('should not refetch keys for every forged signature', async () => {
      const handle = await loadHandler();
      const forgedKeys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
        'sign',
        'verify',
      ]);

      await handle(await createPayload(completedBody));
      for (let i = 0; i < 3; i++) {
        await expect(
          handle(await createPayload(completedBody, { signingKey: forgedKeys.privateKey })),
        ).rejects.toThrow('Invalid Google webhook signature');
      }

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('should refresh keys once the cooldown has passed to pick up rotated keys', async () => {
      const handle = await loadHandler();
      const oldKeys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
        'sign',
        'verify',
      ]);
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          jwksResponse(await crypto.subtle.exportKey('jwk', oldKeys.publicKey)),
        )
        .mockResolvedValueOnce(jwksResponse(publicJwk));

      await handle(await createPayload(completedBody, { signingKey: oldKeys.privateKey }));
      vi.setSystemTime(Date.now() + 61 * 1000);

      await expect(handle(await createPayload(completedBody))).resolves.toMatchObject({
        status: 'completed',
      });
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });
});
