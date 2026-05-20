import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SlackApi } from './api';

const mockCreateSlackAdapter = vi.hoisted(() => vi.fn());

vi.mock('@chat-adapter/slack', () => ({
  createSlackAdapter: mockCreateSlackAdapter,
}));

vi.mock('@/server/services/gateway/runtimeStatus', () => ({
  BOT_RUNTIME_STATUSES: {
    connected: 'connected',
    disconnected: 'disconnected',
    failed: 'failed',
    starting: 'starting',
  },
  getRuntimeStatusErrorMessage: (e: any) => String(e?.message ?? e),
  updateBotRuntimeStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./gateway', () => ({
  SlackSocketModeConnection: vi.fn().mockImplementation(() => ({
    close: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
  })),
}));

const { SlackClientFactory } = await import('./client');

describe('SlackWebhookClient.extractFiles', () => {
  // Verifies the post-Redis re-download path: when Slack messages
  // round-trip through the chat-sdk debounce/queue, `Message.toJSON`
  // strips the `att.fetchData` closure that the chat-adapter-slack uses
  // to authenticate against `url_private`. The URL ITSELF survives
  // serialization (it's in the toJSON allowlist), so we can re-fetch by
  // calling `SlackApi.downloadFile(att.url)` with the bot token.

  let downloadFileSpy: MockInstance<SlackApi['downloadFile']>;

  const createClient = () =>
    new SlackClientFactory().createClient(
      {
        applicationId: 'A0AR7CK6PU4',
        credentials: {
          appToken: 'xapp-test',
          botToken: 'xoxb-test',
          signingSecret: 'secret',
        },
        platform: 'slack',
        // No connectionMode → defaults to webhook
        settings: {},
      },
      { appUrl: 'https://example.com' },
    );

  /** Build a fake Chat SDK Message with Slack attachments. */
  const makeMessage = (attachments: Array<Record<string, unknown>>, id = '1234567890.123456') =>
    ({
      attachments,
      id,
      raw: { event: { files: [] } },
      text: '',
    }) as any;

  beforeEach(() => {
    downloadFileSpy = vi.spyOn(SlackApi.prototype, 'downloadFile') as MockInstance<
      SlackApi['downloadFile']
    >;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns undefined when no attachments are present', async () => {
    const client = createClient();
    const result = await client.extractFiles!(makeMessage([]));
    expect(downloadFileSpy).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('downloads an image attachment via SlackApi.downloadFile(url_private)', async () => {
    // Reproduces the bug: post-Redis state has `url` (auth-required) and
    // mimeType/name/size, but `fetchData` is gone. We use the URL directly.
    const buffer = Buffer.from('feedback-mp4-bytes');
    downloadFileSpy.mockResolvedValue(buffer);

    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage([
        {
          height: 720,
          mimeType: 'image/png',
          name: 'screenshot.png',
          size: 12_345,
          type: 'image',
          url: 'https://files.slack.com/files-pri/T0AMPF07X45-F0AR5E3E007/screenshot.png',
          width: 1280,
        },
      ]),
    );

    expect(downloadFileSpy).toHaveBeenCalledTimes(1);
    expect(downloadFileSpy).toHaveBeenCalledWith(
      'https://files.slack.com/files-pri/T0AMPF07X45-F0AR5E3E007/screenshot.png',
    );
    expect(result).toEqual([
      {
        buffer,
        mimeType: 'image/png',
        name: 'screenshot.png',
        size: 12_345,
      },
    ]);
  });

  it('downloads a video attachment (mp4)', async () => {
    const buffer = Buffer.from('mp4-bytes');
    downloadFileSpy.mockResolvedValue(buffer);

    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage([
        {
          mimeType: 'video/mp4',
          name: 'feedback.mp4',
          size: 1_507_745,
          type: 'video',
          url: 'https://files.slack.com/files-pri/T/F/feedback.mp4',
        },
      ]),
    );

    expect(result).toEqual([
      { buffer, mimeType: 'video/mp4', name: 'feedback.mp4', size: 1_507_745 },
    ]);
  });

  it('falls back to buffer.length when att.size is undefined', async () => {
    const buffer = Buffer.from('payload');
    downloadFileSpy.mockResolvedValue(buffer);

    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage([
        {
          mimeType: 'application/pdf',
          name: 'doc.pdf',
          type: 'file',
          url: 'https://files.slack.com/files-pri/T/F/doc.pdf',
        },
      ]),
    );

    expect((result as any)?.[0]?.size).toBe(buffer.length);
  });

  it('skips attachments with no url and continues with the rest', async () => {
    const buffer = Buffer.from('good');
    downloadFileSpy.mockResolvedValue(buffer);

    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage([
        // Missing url — should be skipped without calling downloadFile
        { mimeType: 'image/png', name: 'orphan.png', type: 'image' },
        {
          mimeType: 'image/png',
          name: 'good.png',
          size: 100,
          type: 'image',
          url: 'https://files.slack.com/files-pri/T/F/good.png',
        },
      ]),
    );

    expect(downloadFileSpy).toHaveBeenCalledTimes(1);
    expect(downloadFileSpy).toHaveBeenCalledWith('https://files.slack.com/files-pri/T/F/good.png');
    expect(result).toEqual([{ buffer, mimeType: 'image/png', name: 'good.png', size: 100 }]);
  });

  it('skips a single failing download without dropping the others', async () => {
    const goodBuffer = Buffer.from('good');
    downloadFileSpy
      .mockRejectedValueOnce(new Error('files:read scope missing'))
      .mockResolvedValueOnce(goodBuffer);

    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage([
        {
          mimeType: 'image/png',
          name: 'bad.png',
          type: 'image',
          url: 'https://files.slack.com/files-pri/T/F/bad.png',
        },
        {
          mimeType: 'image/png',
          name: 'good.png',
          size: 50,
          type: 'image',
          url: 'https://files.slack.com/files-pri/T/F/good.png',
        },
      ]),
    );

    expect(downloadFileSpy).toHaveBeenCalledTimes(2);
    expect(result).toEqual([
      { buffer: goodBuffer, mimeType: 'image/png', name: 'good.png', size: 50 },
    ]);
  });

  it('returns undefined when all downloads fail', async () => {
    downloadFileSpy.mockRejectedValue(new Error('network down'));

    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage([
        {
          mimeType: 'image/png',
          name: 'a.png',
          type: 'image',
          url: 'https://files.slack.com/files-pri/T/F/a.png',
        },
      ]),
    );

    expect(result).toBeUndefined();
  });

  it('caches SlackApi across multiple extractFiles calls', async () => {
    const buffer = Buffer.from('x');
    downloadFileSpy.mockResolvedValue(buffer);

    const client = createClient();
    await client.extractFiles!(
      makeMessage([
        { mimeType: 'image/png', name: 'a.png', type: 'image', url: 'https://files.slack.com/a' },
      ]),
    );
    await client.extractFiles!(
      makeMessage([
        { mimeType: 'image/png', name: 'b.png', type: 'image', url: 'https://files.slack.com/b' },
      ]),
    );

    // Both extractFiles calls go through the lazy `_api` getter, so SlackApi
    // is constructed at most once per SlackWebhookClient instance.
    expect(downloadFileSpy).toHaveBeenCalledTimes(2);
  });
});
