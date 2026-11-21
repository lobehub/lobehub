import { CANVAS_CODE_LANGUAGES } from '@lobechat/canvas';
import { isSupportedLanguage } from '@pierre/highlights';
import { describe, expect, it } from 'vitest';

import { highlightCode } from './highlight';

describe('highlight add-on', () => {
  it('supports every language the component reference promises', () => {
    expect(CANVAS_CODE_LANGUAGES.filter((lang) => !isSupportedLanguage(lang))).toEqual([]);
  });

  it('colors code with theme variables and accepts common aliases', async () => {
    const html = await highlightCode('const ids: string[] = [];', 'ts');

    expect(html).toContain('const');
    expect(html).toMatch(/style="color:\s?var\(--lobe-/);
    expect(await highlightCode('echo hi', 'sh')).toMatch(/style="color:\s?var\(--lobe-/);
  });

  it('shows an unknown language as escaped plain text', async () => {
    const html = await highlightCode('a < b', 'brainfudge');

    expect(html).toContain('a &lt; b');
    expect(html).not.toMatch(/<span style="color:\s?var\(--lobe-color-success/);
  });
});
