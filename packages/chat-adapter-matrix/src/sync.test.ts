import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MatrixApiClient } from './api';
import { MatrixSyncConnection } from './sync';
import type { MatrixSyncResponse, MatrixWebhookPayload } from './types';

const BOT = '@bot:example.org';
const WEBHOOK = 'https://lobehub.test/api/agent/webhooks/matrix/@bot:example.org';

const fetchSpy = vi.spyOn(globalThis, 'fetch');

function fakeApi(sync: Partial<MatrixApiClient>): MatrixApiClient {
  return { joinRoom: vi.fn().mockResolvedValue({ room_id: 'r' }), ...sync } as any;
}

function forwarded(): MatrixWebhookPayload[] {
  return fetchSpy.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
}

beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));
});

describe('MatrixSyncConnection.dispatch', () => {
  it('forwards inbound messages but skips the bot echo and edits', async () => {
    const res: MatrixSyncResponse = {
      next_batch: 's2',
      rooms: {
        join: {
          '!room:example.org': {
            summary: { 'm.joined_member_count': 4 },
            timeline: {
              events: [
                {
                  content: { body: 'hello', msgtype: 'm.text' },
                  event_id: '$a',
                  sender: '@alice:example.org',
                  type: 'm.room.message',
                },
                {
                  content: { body: 'echo', msgtype: 'm.notice' },
                  event_id: '$b',
                  sender: BOT,
                  type: 'm.room.message',
                },
                {
                  content: {
                    body: '* edited',
                    ['m.relates_to']: { event_id: '$a', rel_type: 'm.replace' },
                    msgtype: 'm.text',
                  },
                  event_id: '$c',
                  sender: '@alice:example.org',
                  type: 'm.room.message',
                },
              ],
            },
          },
        },
      },
    };

    const api = fakeApi({
      sync: vi
        .fn()
        .mockResolvedValueOnce({ next_batch: 's1' }) // bootstrap
        .mockResolvedValue(res),
    });
    const conn = new MatrixSyncConnection(api, { botUserId: BOT, webhookUrl: WEBHOOK });

    await conn.bootstrap();
    // Run a single poll iteration by aborting right after dispatch.
    await (conn as any).dispatchMessages(res);

    const payloads = forwarded();
    expect(payloads).toHaveLength(1);
    expect(payloads[0].event.event_id).toBe('$a');
    expect(payloads[0].room_id).toBe('!room:example.org');
    expect(payloads[0].is_direct).toBe(false);
  });

  it('marks rooms with <= 2 members as direct', async () => {
    const res: MatrixSyncResponse = {
      next_batch: 's2',
      rooms: {
        join: {
          '!dm:example.org': {
            summary: { 'm.joined_member_count': 2 },
            timeline: {
              events: [
                {
                  content: { body: 'hi', msgtype: 'm.text' },
                  event_id: '$d',
                  sender: '@alice:example.org',
                  type: 'm.room.message',
                },
              ],
            },
          },
        },
      },
    };
    const conn = new MatrixSyncConnection(fakeApi({}), { botUserId: BOT, webhookUrl: WEBHOOK });
    await (conn as any).dispatchMessages(res);
    expect(forwarded()[0].is_direct).toBe(true);
  });
});

describe('MatrixSyncConnection.acceptInvites', () => {
  it('auto-joins invited rooms', async () => {
    const joinRoom = vi.fn().mockResolvedValue({ room_id: '!inv:example.org' });
    const api = fakeApi({ joinRoom });
    const conn = new MatrixSyncConnection(api, { botUserId: BOT, webhookUrl: WEBHOOK });
    await (conn as any).acceptInvites({
      next_batch: 's',
      rooms: {
        invite: {
          '!inv:example.org': {
            invite_state: {
              events: [
                {
                  content: { is_direct: true, membership: 'invite' },
                  event_id: '$i',
                  sender: '@alice:example.org',
                  type: 'm.room.member',
                },
              ],
            },
          },
        },
      },
    } as MatrixSyncResponse);
    expect(joinRoom).toHaveBeenCalledWith('!inv:example.org');
  });
});
