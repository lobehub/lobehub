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
});
