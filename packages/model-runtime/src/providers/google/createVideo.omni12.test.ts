// @vitest-environment node
import type { GoogleGenAI } from '@google/genai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { imageUrlToBase64 } from '../../utils/imageToBase64';
import { createGoogleVideo } from './createVideo';

vi.mock('../../utils/imageToBase64', () => ({
  imageUrlToBase64: vi.fn(async () => ({
    base64: 'mock-base64-data',
    mimeType: 'image/jpeg',
  })),
}));

describe('Gemini Omni 1.2 video', () => {
  const createInteraction = vi.fn();
  const client = { interactions: { create: createInteraction } } as unknown as GoogleGenAI;

  beforeEach(() => {
    vi.clearAllMocks();
    createInteraction.mockResolvedValue({ id: 'interactions/edit-456' });
  });

  it('sends new Omni 1.2 edit references without resending source images', async () => {
    await createGoogleVideo(client, 'google', {
      editReferenceImageUrls: ['https://example.com/new-reference.jpg'],
      model: 'gemini-omni-1.2-flash',
      params: {
        imageUrls: ['https://example.com/stale-reference.jpg'],
        prompt: 'Use this new object',
      },
      previousInteractionId: 'interactions/source-123',
    });

    const request = createInteraction.mock.calls[0][0];
    expect(request).toMatchObject({
      input: [
        { data: 'mock-base64-data', mime_type: 'image/jpeg', type: 'image' },
        { text: 'Use this new object', type: 'text' },
      ],
      previous_interaction_id: 'interactions/source-123',
    });
    expect(request).not.toHaveProperty('generation_config');
    expect(imageUrlToBase64).toHaveBeenCalledExactlyOnceWith(
      'https://example.com/new-reference.jpg',
    );
  });

  const imageUrl = 'https://example.com/start.jpg';
  const endImageUrl = 'https://example.com/end.jpg';
  const imageUrls = Array.from({ length: 6 }, () => imageUrl);

  it.each([
    { error: 'up to 6 images', params: { endImageUrl, imageUrls } },
    { error: 'up to 10 seconds', params: { duration: 11, endImageUrl, imageUrl } },
  ])('enforces the Gemini Omni 1.2 limit ($error)', async ({ error, params }) => {
    await expect(
      createGoogleVideo(client, 'google', {
        model: 'gemini-omni-1.2-flash',
        params: { ...params, prompt: 'Animate a still life' },
      }),
    ).rejects.toMatchObject({ error: { message: expect.stringContaining(error) } });
    expect(createInteraction).not.toHaveBeenCalled();
  });
});
