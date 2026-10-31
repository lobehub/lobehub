// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { createContextInner } from '@/libs/trpc/lambda/context';

import { pushRouter } from './push';
import { FANOUT_CAP, trackInFlight } from './testUtils';

const { mockFindFileById, mockGetFileAccessUrl, mockGetServerDB, mockSendMessengerPush } =
  vi.hoisted(() => ({
    mockFindFileById: vi.fn(),
    mockGetFileAccessUrl: vi.fn(),
    mockGetServerDB: vi.fn(),
    mockSendMessengerPush: vi.fn(),
  }));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: mockGetServerDB }));
vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkModel: class {
    list = vi.fn().mockResolvedValue([]);
  },
}));
vi.mock('@/database/models/file', () => ({
  FileModel: class {
    findById = mockFindFileById;
  },
}));
vi.mock('@/server/services/file', () => ({
  FileService: class {
    getFileAccessUrl = mockGetFileAccessUrl;
  },
}));
vi.mock('@/server/services/messenger/push', () => ({
  getMessengerPushWindow: vi.fn(),
  MESSENGER_PUSH_PLATFORMS: ['telegram', 'slack', 'discord', 'wechat'],
  sendMessengerPush: mockSendMessengerPush,
}));

const createCaller = createCallerFactory(pushRouter);
const caller = async () => createCaller(await createContextInner({ userId: 'user-1' }));

describe('messenger push fan-outs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerDB.mockResolvedValue({ kind: 'server-db' });
  });

  it('sendMessengerPush bounds attachment resolution and keeps attachment order', async () => {
    const attachmentCount = 10;
    const tracker = trackInFlight((id: string) => ({
      fileType: 'image/png',
      id,
      name: `${id}.png`,
      size: 1,
      url: `s3://bucket/${id}.png`,
    }));
    mockFindFileById.mockImplementation(tracker.fn);
    mockGetFileAccessUrl.mockImplementation(async ({ id }: { id: string }) => `https://f/${id}`);
    mockSendMessengerPush.mockResolvedValue({ status: 'sent' });

    await (
      await caller()
    ).sendMessengerPush({
      attachments: Array.from({ length: attachmentCount }, (_, i) => ({
        fileId: `file-${i}`,
        type: 'image' as const,
      })),
      platform: 'telegram',
    });

    const [{ attachments }] = mockSendMessengerPush.mock.calls[0];
    expect(attachments.map((a: { fetchUrl: string }) => a.fetchUrl)).toEqual(
      Array.from({ length: attachmentCount }, (_, i) => `https://f/file-${i}`),
    );
    expect(tracker.state.peak).toBeGreaterThan(1);
    expect(tracker.state.peak).toBeLessThanOrEqual(FANOUT_CAP);
  });
});
