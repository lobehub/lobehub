import { createHash, randomUUID } from 'node:crypto';

import {
  type ConversationConfig,
  type LivekitConnection,
  VOICE_AGENT_NAME,
} from '@lobechat/livekit-bridge';
import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import { AccessToken, RoomAgentDispatch, RoomConfiguration, TrackSource } from 'livekit-server-sdk';

/** The namespace is derived from the authenticated user, never supplied by the client. */
export const voiceRoomPrefix = (userId: string) =>
  `lobe-voice-${createHash('sha256').update(userId).digest('hex').slice(0, 24)}-`;

export class LivekitService {
  constructor(
    private readonly userId: string,
    private readonly connection: LivekitConnection,
  ) {}

  async createSession(config: ConversationConfig) {
    const roomName = voiceRoomPrefix(this.userId) + randomUUID();
    const participantIdentity = `user-${randomUUID()}`;
    const token = new AccessToken(this.connection.apiKey, this.connection.apiSecret, {
      identity: participantIdentity,
      ttl: '5m',
    });
    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canPublishSources:
        config.mode === 'video'
          ? [TrackSource.MICROPHONE, TrackSource.CAMERA, TrackSource.SCREEN_SHARE]
          : [TrackSource.MICROPHONE],
      canSubscribe: true,
      canPublishData: true,
    });
    token.roomConfig = new RoomConfiguration({
      emptyTimeout: 60,
      departureTimeout: 20,
      maxParticipants: 2,
      agents: [
        new RoomAgentDispatch({
          agentName: VOICE_AGENT_NAME,
          metadata: JSON.stringify({
            participantIdentity,
            config: { language: config.language, silenceMs: config.silenceMs },
          }),
        }),
      ],
    });
    return { config, roomName, serverUrl: this.connection.url, token: await token.toJwt() };
  }

  async endSession(roomName: string) {
    // A caller may delete only the rooms minted in their own namespace.
    if (!roomName.startsWith(voiceRoomPrefix(this.userId))) throw new Error('Invalid voice room');
    await this.adminRequest('DeleteRoom', { room: roomName });
  }

  async checkConnection() {
    await this.adminRequest('ListRooms', {});
    return { ok: true as const };
  }

  private async adminRequest(method: 'ListRooms' | 'DeleteRoom', body: object) {
    const token = new AccessToken(this.connection.apiKey, this.connection.apiSecret, { ttl: '1m' });
    token.addGrant(method === 'DeleteRoom' ? { roomCreate: true } : { roomList: true });
    const url = this.connection.url.replace(/^ws/, 'http').replace(/\/$/, '');
    const response = await ssrfSafeFetch(`${url}/twirp/livekit.RoomService/${method}`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: {
        'Authorization': `Bearer ${await token.toJwt()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok && !(method === 'DeleteRoom' && response.status === 404)) {
      throw new Error('LiveKit connection failed. Check the server URL and credentials.');
    }
    await response.body?.cancel();
  }
}
