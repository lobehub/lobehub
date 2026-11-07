import { describe, expect, it } from 'vitest';

import { containsHan, loadPinyinTexts } from './pinyin';

describe('containsHan', () => {
  it('detects Han characters', () => {
    expect(containsHan('主题')).toBe(true);
    expect(containsHan('OpenAI 密钥')).toBe(true);
    expect(containsHan('dark mode')).toBe(false);
  });
});

describe('loadPinyinTexts', () => {
  it('produces full pinyin and initials for Han text', async () => {
    const pinyinTexts = await loadPinyinTexts();
    expect(pinyinTexts!('主题')).toEqual(['zhuti', 'zt']);
    expect(pinyinTexts!('快捷键')).toEqual(['kuaijiejian', 'kjj']);
  });

  it('strips non-Han characters from mixed text', async () => {
    const pinyinTexts = await loadPinyinTexts();
    expect(pinyinTexts!('openai 密钥')).toEqual(['miyao', 'my']);
  });

  it('skips single-letter initials that would match everything', async () => {
    const pinyinTexts = await loadPinyinTexts();
    expect(pinyinTexts!('图')).toEqual(['tu']);
  });

  it('returns empty for non-Han text', async () => {
    const pinyinTexts = await loadPinyinTexts();
    expect(pinyinTexts!('dark mode')).toEqual([]);
  });
});
