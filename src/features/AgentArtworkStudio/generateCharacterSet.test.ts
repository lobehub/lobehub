import { describe, expect, it, vi } from 'vitest';

import { generateCharacterSet } from './generateCharacterSet';

const input = {
  id: 'agent-1',
  kind: 'avatar' as const,
  style: 'anime' as const,
  styleReferenceImageUrls: ['https://example.com/anime-style.webp'],
};

describe('generateCharacterSet', () => {
  it('generates the avatar first and uses it as the full-body character reference', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce('https://example.com/generated-avatar.webp')
      .mockResolvedValueOnce('https://example.com/generated-full-body.webp');

    const result = await generateCharacterSet({ generate, input });

    expect(generate).toHaveBeenNthCalledWith(1, { ...input, composition: 'avatar' });
    expect(generate).toHaveBeenNthCalledWith(2, {
      ...input,
      composition: 'fullBody',
      persist: false,
      referenceImageUrl: 'https://example.com/generated-avatar.webp',
      styleReferenceImageUrls: undefined,
    });
    expect(result.fullBodyUrl).toBe('https://example.com/generated-full-body.webp');
  });

  it('uses the current avatar when only the full-body image is generated', async () => {
    const generate = vi.fn().mockResolvedValue('https://example.com/generated-full-body.webp');

    await generateCharacterSet({
      composition: 'fullBody',
      currentAvatarUrl: 'https://example.com/current-avatar.webp',
      generate,
      input,
    });

    expect(generate).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        composition: 'fullBody',
        referenceImageUrl: 'https://example.com/current-avatar.webp',
        styleReferenceImageUrls: undefined,
      }),
    );
  });
});
