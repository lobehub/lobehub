import { describe, expect, it } from 'vitest';

import { resolveFontFamilyOverride } from './fontFamilyOverride';

describe('resolveFontFamilyOverride', () => {
  it('leaves both stacks to theme.css when no custom font is set', () => {
    expect(
      resolveFontFamilyOverride({
        customFontFamily: ' ',
        locale: 'ja-JP',
        userFontFamily: '',
        userFontFamilyCode: undefined,
      }),
    ).toEqual({ fontFamily: undefined, fontFamilyCode: undefined });
  });

  it('puts the user font first, then the env custom font, ahead of the locale stack', () => {
    const { fontFamily, fontFamilyCode } = resolveFontFamilyOverride({
      customFontFamily: 'Env Font',
      locale: 'zh-CN',
      userFontFamily: ' LXGW WenKai ',
    });

    expect(fontFamily?.startsWith('"LXGW WenKai","Env Font","HarmonyOS Sans",')).toBe(true);
    expect(fontFamilyCode).toBeUndefined();
  });

  it('overrides only the code stack when only a terminal font is set', () => {
    const { fontFamily, fontFamilyCode } = resolveFontFamilyOverride({
      locale: 'ja-JP',
      userFontFamilyCode: 'JetBrains Mono',
    });

    expect(fontFamily).toBeUndefined();
    expect(fontFamilyCode?.startsWith('"JetBrains Mono","Geist Mono",')).toBe(true);
    expect(fontFamilyCode).toContain('"Hiragino Sans"');
  });
});
