import { describe, expect, it } from 'vitest';

import { shikiCdnUrl } from './shikiCdn';

const v = '4.4.3';

describe('shikiCdnUrl', () => {
  it.each([
    ['shiki', `https://esm.sh/shiki@${v}`],
    ['shiki/core', `https://esm.sh/shiki@${v}/core`],
    ['@shikijs/transformers', `https://esm.sh/@shikijs/transformers@${v}`],
    ['@shikijs/langs/python', `https://esm.sh/@shikijs/langs@${v}/python`],
  ])('%s → %s', (source, url) => {
    expect(shikiCdnUrl(source, v)).toBe(url);
  });

  it.each(['react', '@/features/Verify/Acceptance'])('leaves %s bundled', (source) => {
    expect(shikiCdnUrl(source, v)).toBeUndefined();
  });
});
