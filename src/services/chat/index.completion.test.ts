import { fetchSSE } from '@lobechat/fetch-sse';
import type { ChatStreamPayload, OpenAIChatMessage } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_AGENT_CONFIG } from '@/const/settings';
import { lambdaClient } from '@/libs/trpc/client';

import { chatService } from './index';

vi.hoisted(() => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
});

vi.mock(import('@lobechat/fetch-sse'), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchSSE: vi.fn(),
}));
vi.mock('../_auth', () => ({
  createHeaderWithAuth: vi.fn(async () => ({})),
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { file: { getReadableUrls: { query: vi.fn() } } },
}));

const messages = (): OpenAIChatMessage[] => [
  {
    content: [
      {
        image_url: { detail: 'auto', url: `${window.location.origin}/f/file_camera` },
        type: 'image_url',
      },
    ],
    role: 'user',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchSSE).mockResolvedValue(new Response('ok'));
});
afterEach(() => vi.restoreAllMocks());

describe('chat completion requests', () => {
  it('should make a POST request with the correct payload', async () => {
    const params: Partial<ChatStreamPayload> = {
      model: 'test-model',
      messages: [],
    };
    const options = {};
    const expectedPayload = {
      model: DEFAULT_AGENT_CONFIG.model,
      stream: true,
      ...DEFAULT_AGENT_CONFIG.params,
      ...params,
      apiMode: 'responses',
    };

    await chatService.getChatCompletion(params, options);

    expect(fetchSSE).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify(expectedPayload),
        headers: expect.any(Object),
        method: 'POST',
      }),
    );
  });

  it('sends signed image URLs without changing persisted message URLs', async () => {
    const signedUrl = 'https://storage.example/photo.jpg?signature=temporary';
    vi.mocked(lambdaClient.file.getReadableUrls.query).mockResolvedValue({
      file_camera: signedUrl,
    });
    const history = messages();
    await chatService.getChatCompletion({ messages: history, model: 'test-model' });
    const body = JSON.parse(vi.mocked(fetchSSE).mock.calls[0][1].body as string);
    expect(body.messages[0].content[0].image_url.url).toBe(signedUrl);
    expect(history).toEqual(messages());
  });

  it('stops an in-flight image lookup without starting model inference', async () => {
    const controller = new AbortController();
    let lookupStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      lookupStarted = resolve;
    });
    vi.mocked(lambdaClient.file.getReadableUrls.query).mockImplementation((_input, options) => {
      lookupStarted();
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
          once: true,
        });
      });
    });
    const request = chatService.getChatCompletion(
      { messages: messages(), model: 'test-model' },
      { signal: controller.signal },
    );
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await started;
    controller.abort();
    await rejection;
    expect(fetchSSE).not.toHaveBeenCalled();
  });

  it('never sends inference or a file lookup for an already cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      chatService.getChatCompletion(
        { messages: messages(), model: 'test-model' },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(lambdaClient.file.getReadableUrls.query).not.toHaveBeenCalled();
    expect(fetchSSE).not.toHaveBeenCalled();
  });

  it('does not send inference after an image permission error', async () => {
    vi.mocked(lambdaClient.file.getReadableUrls.query).mockRejectedValue(new Error('NOT_FOUND'));
    await expect(
      chatService.getChatCompletion({ messages: messages(), model: 'test-model' }),
    ).rejects.toThrow('NOT_FOUND');
    expect(fetchSSE).not.toHaveBeenCalled();
  });
});
