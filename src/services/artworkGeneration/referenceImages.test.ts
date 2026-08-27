import { describe, expect, it } from 'vitest';

import { resolveArtworkReferenceImageUrl, resolveArtworkReferences } from './referenceImages';

describe('resolveArtworkReferenceImageUrl', () => {
  it.each([
    'https://example.com/avatar.webp',
    'http://example.com/avatar.png',
    'data:image/png;base64,abc',
  ])('keeps the supported image source %s', (source) => {
    expect(resolveArtworkReferenceImageUrl(source, 'https://app.example.com')).toBe(source);
  });

  it.each([
    ['/avatars/lobe-ai.png', 'https://app.example.com/avatars/lobe-ai.png'],
    ['/avatars/agent-default.png', 'https://app.example.com/avatars/agent-default.png'],
  ])('resolves the app-relative image source %s', (source, expected) => {
    expect(resolveArtworkReferenceImageUrl(source, 'https://app.example.com')).toBe(expected);
  });

  it.each(['🦄', '#fff', 'rgb(0, 0, 0)', 'transparent', '//example.com/avatar.png'])(
    'ignores the unsupported image source %s',
    (source) => {
      expect(resolveArtworkReferenceImageUrl(source, 'https://app.example.com')).toBeUndefined();
    },
  );

  it('does not resolve an app-relative image source without an app origin', () => {
    expect(resolveArtworkReferenceImageUrl('/avatars/lobe-ai.png')).toBeUndefined();
  });
});

describe('resolveArtworkReferences', () => {
  it('filters invalid style references before applying their precedence', () => {
    expect(
      resolveArtworkReferences({
        imageInputLimit: 2,
        referenceImageUrl: 'https://example.com/avatar.webp',
        styleReferenceImageUrls: ['🦄', '#fff'],
      }),
    ).toEqual({
      imageUrls: ['https://example.com/avatar.webp'],
      referenceImageUrl: 'https://example.com/avatar.webp',
      styleReferenceImageUrls: [],
    });
  });

  it('attaches only valid style references up to the model limit', () => {
    expect(
      resolveArtworkReferences({
        imageInputLimit: 1,
        referenceImageUrl: 'https://example.com/avatar.webp',
        styleReferenceImageUrls: [
          '/avatars/lobe-ai.png',
          'https://example.com/style-a.webp',
          'data:image/png;base64,style-b',
        ],
      }),
    ).toEqual({
      imageUrls: ['https://example.com/style-a.webp'],
      referenceImageUrl: undefined,
      styleReferenceImageUrls: ['https://example.com/style-a.webp'],
    });
  });

  it('does not expose references to a model without image inputs', () => {
    expect(
      resolveArtworkReferences({
        imageInputLimit: 0,
        referenceImageUrl: 'https://example.com/avatar.webp',
        styleReferenceImageUrls: ['https://example.com/style.webp'],
      }),
    ).toEqual({
      imageUrls: undefined,
      referenceImageUrl: undefined,
      styleReferenceImageUrls: [],
    });
  });
});
