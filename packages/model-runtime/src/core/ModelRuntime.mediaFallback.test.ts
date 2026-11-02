// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatStreamPayload } from '../types';
import { imageUrlToBase64 } from '../utils/imageToBase64';
import { ModelRuntime } from './ModelRuntime';

vi.mock('../providers/lobehub', () => ({
  LobeHubAI: class LobeHubAI {},
}));

vi.mock('../utils/imageToBase64', () => ({ imageUrlToBase64: vi.fn() }));

const IMAGE_URL = 'https://files.example.com/screenshot.png';

const mediaFetchError = {
  error: {
    error: { code: 'upstream_bad_request', message: 'failed to download or process media content' },
    status: 400,
  },
  errorType: 'InvalidRequestFormat',
  provider: 'openai',
};

const payload: ChatStreamPayload = {
  messages: [
    {
      content: [
        { text: 'what is in this picture?', type: 'text' },
        { image_url: { url: IMAGE_URL }, type: 'image_url' },
      ],
      role: 'user',
    },
    { content: 'A dashboard.', role: 'assistant' },
    { content: 'and now just answer in text', role: 'user' },
  ],
  model: 'mimo-v2.6-flash',
  temperature: 0,
};

const createRuntime = (onChatError = vi.fn()) => {
  const mockRuntimeAI = { chat: vi.fn() } as any;
  return { mockRuntimeAI, onChatError, runtime: new ModelRuntime(mockRuntimeAI, { onChatError }) };
};

const sentImagePart = (mockRuntimeAI: any, call: number) =>
  mockRuntimeAI.chat.mock.calls[call][0].messages[0].content[1];

describe('ModelRuntime chat media fallback', () => {
  beforeEach(() => {
    vi.mocked(imageUrlToBase64).mockReset();
  });

  it('retries with the image inlined as base64 when the provider cannot fetch its URL', async () => {
    vi.mocked(imageUrlToBase64).mockResolvedValue({ base64: 'iVBOR', mimeType: 'image/png' });
    const { runtime, mockRuntimeAI, onChatError } = createRuntime();
    const response = new Response('ok');
    mockRuntimeAI.chat.mockRejectedValueOnce(mediaFetchError).mockResolvedValueOnce(response);

    await expect(runtime.chat(payload)).resolves.toBe(response);

    expect(mockRuntimeAI.chat).toHaveBeenCalledTimes(2);
    expect(sentImagePart(mockRuntimeAI, 1)).toEqual({
      image_url: { url: 'data:image/png;base64,iVBOR' },
      type: 'image_url',
    });
    expect(onChatError).not.toHaveBeenCalled();
  });

  it('falls back to a text placeholder when the inlined image is still rejected', async () => {
    vi.mocked(imageUrlToBase64).mockResolvedValue({ base64: 'iVBOR', mimeType: 'image/png' });
    const { runtime, mockRuntimeAI } = createRuntime();
    const response = new Response('ok');
    mockRuntimeAI.chat
      .mockRejectedValueOnce(mediaFetchError)
      .mockRejectedValueOnce(mediaFetchError)
      .mockResolvedValueOnce(response);

    await expect(runtime.chat(payload)).resolves.toBe(response);

    expect(mockRuntimeAI.chat).toHaveBeenCalledTimes(3);
    const lastMessages = mockRuntimeAI.chat.mock.calls[2][0].messages;
    expect(lastMessages[0].content[1]).toEqual({
      text: `[Image omitted: the model provider could not download or process it. Original URL: ${IMAGE_URL}]`,
      type: 'text',
    });
    expect(lastMessages.slice(1)).toEqual(payload.messages.slice(1));
  });

  it('uses the placeholder directly when our own download of the image fails', async () => {
    vi.mocked(imageUrlToBase64).mockRejectedValue(new Error('404'));
    const { runtime, mockRuntimeAI } = createRuntime();
    mockRuntimeAI.chat.mockRejectedValueOnce(mediaFetchError).mockResolvedValueOnce(new Response());

    await runtime.chat(payload);

    expect(mockRuntimeAI.chat).toHaveBeenCalledTimes(2);
    expect(sentImagePart(mockRuntimeAI, 1).type).toBe('text');
  });

  it('does not retry unrelated errors', async () => {
    const { runtime, mockRuntimeAI, onChatError } = createRuntime();
    const error = { error: { message: 'Invalid API key' }, errorType: 'InvalidProviderAPIKey' };
    mockRuntimeAI.chat.mockRejectedValue(error);

    await expect(runtime.chat(payload)).rejects.toBe(error);

    expect(mockRuntimeAI.chat).toHaveBeenCalledTimes(1);
    expect(onChatError).toHaveBeenCalledWith(error, expect.anything());
  });

  it('does not retry a media error when the request carries no media', async () => {
    const { runtime, mockRuntimeAI } = createRuntime();
    mockRuntimeAI.chat.mockRejectedValue(mediaFetchError);

    await expect(
      runtime.chat({ ...payload, messages: [{ content: 'hi', role: 'user' }] }),
    ).rejects.toBe(mediaFetchError);

    expect(mockRuntimeAI.chat).toHaveBeenCalledTimes(1);
  });

  it('surfaces a non-media error raised by the inlined retry', async () => {
    vi.mocked(imageUrlToBase64).mockResolvedValue({ base64: 'iVBOR', mimeType: 'image/png' });
    const { runtime, mockRuntimeAI, onChatError } = createRuntime();
    const quotaError = { error: { message: 'quota exceeded' }, errorType: 'InsufficientQuota' };
    mockRuntimeAI.chat.mockRejectedValueOnce(mediaFetchError).mockRejectedValueOnce(quotaError);

    await expect(runtime.chat(payload)).rejects.toBe(quotaError);

    expect(mockRuntimeAI.chat).toHaveBeenCalledTimes(2);
    expect(onChatError).toHaveBeenCalledWith(quotaError, expect.anything());
  });
});
