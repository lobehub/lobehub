import { describe, expect, it } from 'vitest';

import { genFontFamily } from './font';

describe('genFontFamily', () => {
  it('puts japanese families ahead of the SC fallback for ja-JP', () => {
    const stack = genFontFamily({ locale: 'ja-JP' });

    expect(stack.indexOf('"Hiragino Sans"')).toBeGreaterThan(-1);
    expect(stack.indexOf('"Hiragino Sans"')).toBeLessThan(stack.indexOf('"HarmonyOS Sans SC"'));
  });

  it('keeps the SC stack first for zh-CN and unknown locales', () => {
    for (const locale of ['zh-CN', 'de-DE', undefined]) {
      const stack = genFontFamily({ locale });

      expect(stack).toContain('"HarmonyOS Sans SC"');
      expect(stack).not.toContain('"PingFang TC"');
      expect(stack).not.toContain('"Hiragino Sans"');
    }
  });

  it('prefers TC families for zh-TW', () => {
    const stack = genFontFamily({ locale: 'zh-TW' });

    expect(stack.indexOf('"PingFang TC"')).toBeLessThan(stack.indexOf('"PingFang SC"'));
  });

  it('puts the user font first, then the env custom font', () => {
    const stack = genFontFamily({
      customFontFamily: 'Env Font',
      locale: 'en-US',
      userFontFamily: ' LXGW WenKai ',
    });

    expect(stack.startsWith('"LXGW WenKai","Env Font",Geist')).toBe(true);
  });

  it('leaves an already composed font-family list untouched', () => {
    expect(
      genFontFamily({ customFontFamily: 'Foo, "Bar Baz"' }).startsWith('Foo, "Bar Baz",Geist'),
    ).toBe(true);
  });
});
