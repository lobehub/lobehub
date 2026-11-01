import { describe, expect, it, vi } from 'vitest';

import { resolveArtworkReferenceImageUrl } from '@/services/artworkGeneration';

import { generateCharacterSet } from './generateCharacterSet';

const input = {
  avatarIdentity: '🦄',
  backgroundIdentity: '#fff',
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

  it.each([
    ['missing', undefined],
    ['an emoji', '🦄'],
    ['a CSS color', '#fff'],
  ])('keeps the style reference when the current avatar is %s', async (_case, currentAvatar) => {
    const generate = vi.fn().mockResolvedValue('https://example.com/generated-full-body.webp');

    await generateCharacterSet({
      composition: 'fullBody',
      currentAvatarUrl: resolveArtworkReferenceImageUrl(currentAvatar, 'https://app.example.com'),
      generate,
      input,
    });

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        composition: 'fullBody',
        referenceImageUrl: undefined,
        styleReferenceImageUrls: input.styleReferenceImageUrls,
      }),
    );
  });

  it('does not reinterpret the profile background image as a full-body character reference', async () => {
    const generate = vi.fn().mockResolvedValue('https://example.com/generated-full-body.webp');

    await generateCharacterSet({
      composition: 'fullBody',
      generate,
      input: { ...input, referenceImageUrl: 'https://example.com/profile-background.webp' },
    });

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        composition: 'fullBody',
        referenceImageUrl: undefined,
        styleReferenceImageUrls: input.styleReferenceImageUrls,
      }),
    );
  });
});
