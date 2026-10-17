import type { OpenAIChatMessage } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { resolveChatImageUrls } from './resolveImageUrls';

const origin = 'https://chat.example';
const image = (url: string): OpenAIChatMessage => ({
  content: [{ image_url: { detail: 'high', url }, type: 'image_url' }],
  role: 'user',
});

describe('resolveChatImageUrls', () => {
  it('resolves camera attachments and history without mutating persisted URLs', async () => {
    const messages = [image('/f/file_camera'), image(`${origin}/f/file_camera?download=1`)];
    const resolve = vi.fn().mockResolvedValue({ file_camera: 'https://storage.example/signed' });
    const result = await resolveChatImageUrls(messages, origin, resolve);
    expect(result.map((m) => m.content)).toEqual([
      [{ image_url: { detail: 'high', url: 'https://storage.example/signed' }, type: 'image_url' }],
      [{ image_url: { detail: 'high', url: 'https://storage.example/signed' }, type: 'image_url' }],
    ]);
    expect(messages[0]).toEqual(image('/f/file_camera'));
    expect(resolve).toHaveBeenCalledTimes(1);
    await resolveChatImageUrls(messages, origin, resolve);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('preserves external, data, blob, malformed and non-proxy images', async () => {
    const messages = [
      'https://external.example/f/file_other',
      'data:image/png;base64,AAA',
      'blob:https://chat.example/image',
      'https://[invalid',
      `${origin}/files/image.png`,
      `${origin}/f/id/extra`,
    ].map(image);
    const resolve = vi.fn();
    expect(await resolveChatImageUrls(messages, origin, resolve)).toEqual(messages);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('preserves text, tools and non-image content', async () => {
    const messages: OpenAIChatMessage[] = [
      { content: 'hello', role: 'user' },
      { content: [{ text: '/f/file_camera', type: 'text' }], role: 'user' },
      { content: 'result', role: 'tool', tool_call_id: 'call_test' },
    ];
    const resolve = vi.fn();
    expect(await resolveChatImageUrls(messages, origin, resolve)).toEqual(messages);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects inaccessible images instead of sending their public proxy URL', async () => {
    const resolve = vi.fn().mockRejectedValue(new Error('NOT_FOUND'));
    await expect(
      resolveChatImageUrls([image('/f/file_other_user')], origin, resolve),
    ).rejects.toThrow('NOT_FOUND');
  });

  it('resolves distinct history images in one batch', async () => {
    const messages = Array.from({ length: 40 }, (_, i) => image(`/f/file_${i}`));
    const urls = Object.fromEntries(
      messages.map((_, i) => [`file_${i}`, `https://storage.example/${i}`]),
    );
    const resolve = vi.fn().mockResolvedValue(urls);
    const result = await resolveChatImageUrls([...messages, messages[0]], origin, resolve);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls[0][0]).toHaveLength(40);
    expect(result[39]).toEqual(image('https://storage.example/39'));
    expect(result[40]).toEqual(image('https://storage.example/0'));
  });

  it('does not start resolution for an already cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    const resolve = vi.fn();
    await expect(
      resolveChatImageUrls([image('/f/file_camera')], origin, resolve, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects a cancelled lookup before returning any model payload', async () => {
    const controller = new AbortController();
    const resolve = vi.fn(async () => {
      controller.abort();
      return { file_camera: 'https://storage.example/signed' };
    });
    await expect(
      resolveChatImageUrls([image('/f/file_camera')], origin, resolve, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects incomplete lookup results instead of forwarding protected URLs', async () => {
    await expect(
      resolveChatImageUrls([image('/f/file_camera')], origin, async () => ({})),
    ).rejects.toThrow('Missing readable URL');
  });
});
