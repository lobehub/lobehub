// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSteadyRouterImage } from './createImage';

const create = vi.fn();
const generate = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function () {
    return { chat: { completions: { create } }, images: { generate } };
  }),
}));

const options = { apiKey: 'test', baseURL: 'https://example.com/v1', provider: 'steadyrouter' } as any;

describe('createSteadyRouterImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads a markdown data URI from a chat reply', async () => {
    create.mockResolvedValue({
      choices: [{ message: { content: 'Here: ![image](data:image/jpeg;base64,AAAA) done' } }],
    });

    const result = await createSteadyRouterImage(
      { model: 'gemini-3.1-flash-image:image', params: { prompt: 'cat' } } as any,
      options,
    );

    expect(result.imageUrl).toBe('data:image/jpeg;base64,AAAA');
    expect(create.mock.calls[0][0].model).toBe('gemini-3.1-flash-image');
  });

  it('throws when a chat reply has no image', async () => {
    create.mockResolvedValue({ choices: [{ message: { content: 'Sorry, I cannot.' } }] });

    await expect(
      createSteadyRouterImage({ model: 'gemini-3-pro-image:image', params: { prompt: 'cat' } } as any, options),
    ).rejects.toThrow('No image generated');
  });

  it('sends other models to the images endpoint', async () => {
    generate.mockResolvedValue({ data: [{ b64_json: 'AAAA' }] });

    const result = await createSteadyRouterImage(
      { model: 'gpt-image-2-c', params: { prompt: 'cat' } } as any,
      options,
    );

    expect(generate).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(result.imageUrl).toContain('AAAA');
  });

  it('sends the mapped model id on the chat route', async () => {
    create.mockResolvedValue({ choices: [{ message: { content: '![image](data:image/jpeg;base64,AAAA)' } }] });

    await createSteadyRouterImage(
      { model: 'my-banana:image', params: { prompt: 'cat' } } as any,
      { ...options, modelIdMapping: { 'my-banana:image': 'gemini-3.1-flash-image' } },
    );

    expect(create.mock.calls[0][0].model).toBe('gemini-3.1-flash-image');
  });

  it('sends the mapped model id on the images endpoint', async () => {
    generate.mockResolvedValue({ data: [{ b64_json: 'AAAA' }] });

    await createSteadyRouterImage(
      { model: 'my-image', params: { prompt: 'cat' } } as any,
      { ...options, modelIdMapping: { 'my-image': 'gpt-image-2-c' } },
    );

    expect(generate.mock.calls[0][0].model).toBe('gpt-image-2-c');
  });
});
