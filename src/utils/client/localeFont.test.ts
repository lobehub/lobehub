import { describe, expect, it } from 'vitest';

import { getLocaleFontConfig, mergeThemeFontFamily } from './localeFont';

describe('getLocaleFontConfig', () => {
  it('returns Vazirmatn config for fa-IR', () => {
    const config = getLocaleFontConfig('fa-IR');

    expect(config).toEqual({
      fontFamily: 'Vazirmatn',
      fontURL: 'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css',
    });
  });

  it('returns Vazirmatn config for fa prefix', () => {
    expect(getLocaleFontConfig('fa')?.fontFamily).toBe('Vazirmatn');
  });

  it('returns null for en-US', () => {
    expect(getLocaleFontConfig('en-US')).toBeNull();
  });

  it('returns null for zh-CN', () => {
    expect(getLocaleFontConfig('zh-CN')).toBeNull();
  });
});

describe('mergeThemeFontFamily', () => {
  it('prepends primary font to the base stack', () => {
    expect(mergeThemeFontFamily('Vazirmatn', 'Geist,sans-serif')).toBe('Vazirmatn,Geist,sans-serif');
  });

  it('returns undefined when primary font is absent', () => {
    expect(mergeThemeFontFamily(undefined, 'Geist,sans-serif')).toBeUndefined();
  });
});
