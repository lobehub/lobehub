import { DEFAULT_AVATAR } from '@lobechat/const';
import type { SidebarAgentItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  AGENT_COVER_PATTERNS,
  coverImageSrc,
  coverPattern,
  pickDominantColor,
  seedCoverColor,
} from './coverColor';

const agent = (overrides: Partial<SidebarAgentItem> = {}): SidebarAgentItem => ({
  id: 'agt_1',
  pinned: false,
  title: 'Agent',
  type: 'agent',
  updatedAt: new Date(0),
  ...overrides,
});

const pixels = (...colors: [number, number, number, number, number][]) =>
  colors.flatMap(([r, g, b, a, count]) => Array.from({ length: count }, () => [r, g, b, a]).flat());

describe('pickDominantColor', () => {
  it('returns nothing for a fully transparent image', () => {
    expect(pickDominantColor(pixels([255, 0, 0, 0, 10]))).toBeUndefined();
  });

  it('lets a colored logo win over a larger white background', () => {
    expect(pickDominantColor(pixels([255, 255, 255, 255, 30], [30, 90, 220, 255, 10]))).toBe(
      'rgb(30, 90, 220)',
    );
  });

  it('lets a small anti-aliased logo win over a mostly white image', () => {
    // A blue mark split across two hue buckets, its edges blended toward white.
    const color = pickDominantColor(
      pixels(
        [255, 255, 255, 255, 400],
        [8, 102, 255, 255, 8],
        [40, 70, 230, 255, 6],
        [170, 200, 250, 255, 10],
      ),
    );
    expect(color).toBe('rgb(31, 101, 248)');
  });

  it('falls back to the neutral average for a grayscale image', () => {
    expect(pickDominantColor(pixels([200, 200, 200, 255, 4], [100, 100, 100, 255, 4]))).toBe(
      'rgb(150, 150, 150)',
    );
  });

  it('picks the heaviest hue when several compete', () => {
    expect(pickDominantColor(pixels([230, 40, 40, 255, 3], [40, 200, 60, 255, 8]))).toBe(
      'rgb(40, 200, 60)',
    );
  });
});

describe('coverImageSrc', () => {
  it('only samples uploaded images', () => {
    expect(coverImageSrc(agent({ avatar: 'https://cdn.example.com/a.png' }))).toBe(
      'https://cdn.example.com/a.png',
    );
    expect(coverImageSrc(agent({ avatar: '🤖' }))).toBeUndefined();
    expect(coverImageSrc(agent({ avatar: DEFAULT_AVATAR }))).toBeUndefined();
    expect(coverImageSrc(agent({ avatar: null }))).toBeUndefined();
  });
});

describe('seedCoverColor', () => {
  it('is stable per agent id', () => {
    expect(seedCoverColor(agent())).toBe(seedCoverColor(agent({ title: 'Renamed' })));
  });
});

describe('coverPattern', () => {
  it('is stable per agent id', () => {
    expect(coverPattern(agent())).toBe(coverPattern(agent({ title: 'Renamed' })));
  });

  it('spreads agents across every texture', () => {
    const seen = new Set(
      Array.from({ length: 200 }, (_, i) => coverPattern(agent({ id: `agt_${i}` }))),
    );
    expect([...seen].sort()).toEqual([...AGENT_COVER_PATTERNS].sort());
  });
});
