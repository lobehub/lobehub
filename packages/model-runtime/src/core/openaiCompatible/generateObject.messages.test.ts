// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as imageToBase64 from '../../utils/imageToBase64';
import { createOpenAICompatibleRuntime } from './index';

vi.mock('../../utils/getModelPricing', () => ({
  getModelPricing: vi.fn().mockResolvedValue(undefined),
}));

const remoteImageUrl = 'https://example.com/image.jpg';
const inlinedImageUrl = 'data:image/jpeg;base64,forced';

const Runtime = createOpenAICompatibleRuntime({
  baseURL: 'https://api.test.com/v1',
  chatCompletion: { forceImageBase64: true },
  provider: 'testprovider',
});

const payload = {
  messages: [
    {
      content: [
        { text: 'Describe it', type: 'text' as const },
        { image_url: { url: remoteImageUrl }, type: 'image_url' as const },
      ],
      role: 'user' as const,
    },
  ],
  model: 'gpt-anything',
  schema: {
    name: 'answer',
    schema: { properties: { title: { type: 'string' } }, type: 'object' as const },
  },
};

const sentImageUrl = (create: ReturnType<typeof vi.spyOn>) =>
  (create.mock.calls[0][0] as any).messages[0].content[1].image_url.url;

describe('generateObject message conversion', () => {
  afterEach(() => vi.restoreAllMocks());

  const mockImage = () =>
    vi
      .spyOn(imageToBase64, 'imageUrlToBase64')
      .mockResolvedValue({ base64: 'forced', mimeType: 'image/jpeg' });

  it('applies forceImageBase64 on the json_schema path', async () => {
    mockImage();
    const runtime = new Runtime({ apiKey: 'test' });
    const create = vi.spyOn(runtime.client.chat.completions, 'create').mockResolvedValue({
      choices: [{ message: { content: '{"title":"ok"}' } }],
    } as any);

    await expect(runtime.generateObject(payload)).resolves.toEqual({ title: 'ok' });

    expect(sentImageUrl(create as any)).toBe(inlinedImageUrl);
  });

  it('applies forceImageBase64 on the forced tool-calling path', async () => {
    mockImage();
    const ToolRuntime = createOpenAICompatibleRuntime({
      baseURL: 'https://api.test.com/v1',
      chatCompletion: { forceImageBase64: true },
      generateObject: { useToolsCalling: true },
      provider: 'testprovider',
    });
    const runtime = new ToolRuntime({ apiKey: 'test' });
    const create = vi.spyOn(runtime.client.chat.completions, 'create').mockResolvedValue({
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: { arguments: '{"title":"ok"}', name: 'answer' },
                id: '1',
                type: 'function',
              },
            ],
          },
        },
      ],
    } as any);

    await expect(runtime.generateObject(payload)).resolves.toEqual({ title: 'ok' });

    expect(sentImageUrl(create as any)).toBe(inlinedImageUrl);
  });
});
