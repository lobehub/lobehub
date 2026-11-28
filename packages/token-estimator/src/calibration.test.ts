import { describe, expect, it } from 'vitest';

import { resolveInputTokenRatio } from './calibration';

const NO_MEDIA = { audio: 0, image: 0, video: 0 };

describe('resolveInputTokenRatio', () => {
  it('uses the anchor request ratio when it is text-only', () => {
    expect(
      resolveInputTokenRatio({
        anchor: { actualTokens: 15_000, estimatedTokens: 10_000, media: NO_MEDIA },
        model: 'gpt-5',
      }),
    ).toEqual({ ratio: 1.5, source: 'anchor' });
  });

  it('prefers the anchor over the family default', () => {
    expect(
      resolveInputTokenRatio({
        anchor: { actualTokens: 12_000, estimatedTokens: 10_000, media: NO_MEDIA },
        family: 'claude-sonnet',
      }),
    ).toEqual({ ratio: 1.2, source: 'anchor' });
  });

  it.each([
    [
      'carried media',
      { actualTokens: 15_000, estimatedTokens: 10_000, media: { ...NO_MEDIA, image: 1 } },
    ],
    ['has unknown media', { actualTokens: 15_000, estimatedTokens: 10_000 }],
    ['has no provider usage', { estimatedTokens: 10_000, media: NO_MEDIA }],
    ['is too small', { actualTokens: 900, estimatedTokens: 600, media: NO_MEDIA }],
    ['is above the range', { actualTokens: 40_000, estimatedTokens: 10_000, media: NO_MEDIA }],
    ['is below the range', { actualTokens: 4000, estimatedTokens: 10_000, media: NO_MEDIA }],
    [
      'carried audio',
      { actualTokens: 15_000, estimatedTokens: 10_000, media: { ...NO_MEDIA, audio: 1 } },
    ],
  ])('falls back to the family default when the anchor %s', (_, anchor) => {
    expect(resolveInputTokenRatio({ anchor, family: 'claude-opus' })).toEqual({
      ratio: 1.35,
      source: 'family',
    });
  });

  it('anchors at the size and range boundaries', () => {
    expect(
      resolveInputTokenRatio({
        anchor: { actualTokens: 3000, estimatedTokens: 1000, media: NO_MEDIA },
      }),
    ).toEqual({ ratio: 3, source: 'anchor' });
    expect(
      resolveInputTokenRatio({
        anchor: { actualTokens: 500, estimatedTokens: 1000, media: NO_MEDIA },
      }),
    ).toEqual({ ratio: 0.5, source: 'anchor' });
  });

  it("keeps the card's own family over a claude model id", () => {
    expect(resolveInputTokenRatio({ family: 'qwen', model: 'qwen3-claude-opus-distill' })).toEqual({
      ratio: 1,
      source: 'none',
    });
  });

  it('matches the model id when the card has no family', () => {
    expect(resolveInputTokenRatio({ model: 'anthropic/Claude-Sonnet-4.5' })).toEqual({
      ratio: 1.35,
      source: 'family',
    });
  });

  it('keeps the raw estimate for other families', () => {
    expect(resolveInputTokenRatio({ family: 'deepseek', model: 'deepseek-chat' })).toEqual({
      ratio: 1,
      source: 'none',
    });
  });
});
