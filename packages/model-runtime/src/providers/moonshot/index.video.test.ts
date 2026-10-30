// @vitest-environment node
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { imageUrlToBase64 } from '../../utils/imageToBase64';
import { LobeMoonshotAnthropicAI } from './index';

const { loadModelsMock } = vi.hoisted(() => ({
  loadModelsMock: vi.fn(),
}));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

vi.mock('../../utils/imageToBase64', () => ({
  imageUrlToBase64: vi.fn(),
}));

const MAX_BYTES = 100 * 1024 * 1024;

const videoMessage = (...urls: string[]) => ({
  content: urls.map((url) => ({ type: 'video_url' as const, video_url: { url } })),
  role: 'user' as const,
});

describe('LobeMoonshotAnthropicAI video input', () => {
  let instance: InstanceType<typeof LobeMoonshotAnthropicAI>;

  const getLastRequestPayload = () => {
    const calls = ((instance as any).client.messages.create as Mock).mock.calls;
    return calls.at(-1)?.[0];
  };

  beforeEach(() => {
    loadModelsMock.mockResolvedValue([]);
    instance = new LobeMoonshotAnthropicAI({ apiKey: 'test' });

    vi.spyOn((instance as any).client.messages, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should inline http video urls as base64 because Kimi rejects remote video urls', async () => {
    vi.mocked(imageUrlToBase64).mockResolvedValue({ base64: 'AAAA', mimeType: 'video/mp4' });

    await instance.chat({
      messages: [
        {
          content: [
            { text: 'What color is the video?', type: 'text' },
            { type: 'video_url', video_url: { url: 'https://example.com/clip.mp4' } },
          ],
          role: 'user',
        },
      ],
      model: 'kimi-k3.1-pro',
      temperature: 1,
    });

    expect(imageUrlToBase64).toHaveBeenCalledWith('https://example.com/clip.mp4', {
      maxBytes: MAX_BYTES,
      signal: expect.any(AbortSignal),
    });
    expect(getLastRequestPayload().messages[0].content).toContainEqual(
      expect.objectContaining({
        source: { data: 'AAAA', media_type: 'video/mp4', type: 'base64' },
        type: 'video',
      }),
    );
  });

  it('should keep data uri videos without fetching', async () => {
    await instance.chat({
      messages: [
        {
          content: [{ type: 'video_url', video_url: { url: 'data:video/mp4;base64,BBBB' } }],
          role: 'user',
        },
      ],
      model: 'kimi-k3.1-pro',
      temperature: 1,
    });

    expect(imageUrlToBase64).not.toHaveBeenCalled();
    expect(getLastRequestPayload().messages[0].content).toContainEqual(
      expect.objectContaining({
        source: { data: 'BBBB', media_type: 'video/mp4', type: 'base64' },
        type: 'video',
      }),
    );
  });

  it('should share one byte budget across all videos in the request', async () => {
    // 'AAAA' decodes to 3 bytes
    vi.mocked(imageUrlToBase64).mockResolvedValue({ base64: 'AAAA', mimeType: 'video/mp4' });

    await instance.chat({
      messages: [videoMessage('https://example.com/a.mp4', 'https://example.com/b.mp4')],
      model: 'kimi-k3.1-pro',
      temperature: 1,
    });

    expect(imageUrlToBase64).toHaveBeenNthCalledWith(1, 'https://example.com/a.mp4', {
      maxBytes: MAX_BYTES,
      signal: expect.any(AbortSignal),
    });
    expect(imageUrlToBase64).toHaveBeenNthCalledWith(2, 'https://example.com/b.mp4', {
      maxBytes: MAX_BYTES - 3,
      signal: expect.any(AbortSignal),
    });
  });

  it('should fail instead of sending more videos once the budget is used up', async () => {
    vi.mocked(imageUrlToBase64).mockResolvedValue({
      base64: 'A'.repeat(Math.ceil(MAX_BYTES / 3) * 4),
      mimeType: 'video/mp4',
    });

    await expect(
      instance.chat({
        messages: [videoMessage('https://example.com/a.mp4', 'https://example.com/b.mp4')],
        model: 'kimi-k3.1-pro',
        temperature: 1,
      }),
    ).rejects.toBeDefined();

    expect(imageUrlToBase64).toHaveBeenCalledTimes(1);
    expect((instance as any).client.messages.create).not.toHaveBeenCalled();
  });
});
