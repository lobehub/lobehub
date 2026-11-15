// @vitest-environment node
import { conversationConfigSchema } from '@lobechat/livekit-bridge';
import { TokenVerifier } from 'livekit-server-sdk';
import { describe, expect, it } from 'vitest';

import { LivekitService, voiceRoomPrefix } from './index';

const connection = {
  url: 'ws://localhost:7880',
  apiKey: 'devkey',
  apiSecret: 'development-secret-for-tests-only',
};

describe('LivekitService', () => {
  const verifier = new TokenVerifier('devkey', 'development-secret-for-tests-only');
  it('mints short-lived, room-scoped microphone-only grants for voice mode', async () => {
    const session = await new LivekitService('alice', connection).createSession(
      conversationConfigSchema.parse({}),
    );
    const claims = await verifier.verify(session.token);
    expect(claims.video).toMatchObject({
      room: session.roomName,
      roomJoin: true,
      canPublishSources: ['microphone'],
    });
    expect(Number(claims.exp) - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(300);
    expect(Number(claims.exp)).toBeGreaterThan(Date.now() / 1000);
    expect(claims.video?.roomAdmin).not.toBe(true);
    expect(session.roomName).toMatch(new RegExp('^' + voiceRoomPrefix('alice')));
    expect(session).not.toHaveProperty('apiSecret');
  });
  it('allows camera and screen video only when configured and dispatches speech settings', async () => {
    const session = await new LivekitService('alice', connection).createSession(
      conversationConfigSchema.parse({ mode: 'video', voice: 'nova' }),
    );
    const claims = await verifier.verify(session.token);
    expect(claims.video?.canPublishSources).toEqual(['microphone', 'camera', 'screen_share']);
    const dispatch = claims.roomConfig?.agents?.[0];
    expect(dispatch?.agentName).toBe('lobehub-voice');
    expect(JSON.parse(dispatch!.metadata!).config).toEqual({ language: 'en', silenceMs: 700 });
    expect(dispatch!.metadata!).not.toContain(connection.apiSecret);
    expect(JSON.parse(dispatch!.metadata!).config).not.toHaveProperty('model');
  });
  it('refuses to delete another user’s room before any network call', async () => {
    const alice = await new LivekitService('alice', connection).createSession(
      conversationConfigSchema.parse({}),
    );
    await expect(new LivekitService('bob', connection).endSession(alice.roomName)).rejects.toThrow(
      'Invalid voice room',
    );
  });
});
