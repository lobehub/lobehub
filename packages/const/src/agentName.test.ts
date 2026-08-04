import { describe, expect, it } from 'vitest';

import { randomAgentName } from './agentName';

const sample = (locale?: string, times = 200) =>
  Array.from({ length: times }, () => randomAgentName(locale));

describe('randomAgentName', () => {
  it('returns a Chinese name for zh locales', () => {
    for (const locale of ['zh-CN', 'zh-TW', 'zh']) {
      for (const name of sample(locale, 50)) {
        expect(name).toMatch(/^\p{Script=Han}+$/u);
      }
    }
  });

  it('returns a Latin-script name for non-zh locales and when locale is unknown', () => {
    for (const locale of ['en-US', 'ja-JP', 'fr-FR', undefined]) {
      for (const name of sample(locale, 50)) {
        expect(name).toMatch(/^[A-Z]+$/i);
      }
    }
  });

  it('draws from a pool rather than always returning the same name', () => {
    expect(new Set(sample('en-US')).size).toBeGreaterThan(1);
    expect(new Set(sample('zh-CN')).size).toBeGreaterThan(1);
  });

  describe('exclude', () => {
    it('never returns an excluded name', () => {
      const taken = Array.from({ length: 200 }, () => randomAgentName('en-US')).slice(0, 5);

      for (let i = 0; i < 200; i++) {
        expect(taken).not.toContain(randomAgentName('en-US', taken));
      }
    });

    it('matches excluded names case- and whitespace-insensitively', () => {
      const name = randomAgentName('en-US');

      for (let i = 0; i < 200; i++) {
        expect(randomAgentName('en-US', [`  ${name.toUpperCase()}  `])).not.toBe(name);
      }
    });

    it('falls back to the full pool when everything is excluded', () => {
      const everything = Array.from({ length: 500 }, () => randomAgentName('zh-CN'));

      expect(randomAgentName('zh-CN', everything)).toMatch(/^\p{Script=Han}+$/u);
    });

    it('ignores blank entries', () => {
      expect(randomAgentName('en-US', ['', '   '])).toMatch(/^[A-Z]+$/i);
    });
  });
});
