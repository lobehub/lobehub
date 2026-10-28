import { genFontFamily, genFontFamilyCode } from '@lobehub/ui';

interface FontFamilyOverrideParams {
  customFontFamily?: string;
  locale?: string;
  userFontFamily?: string;
  userFontFamilyCode?: string;
}

const hasFont = (font?: string) => !!font?.trim();

export const resolveFontFamilyOverride = ({
  customFontFamily,
  locale,
  userFontFamily,
  userFontFamilyCode,
}: FontFamilyOverrideParams) => ({
  fontFamily:
    hasFont(userFontFamily) || hasFont(customFontFamily)
      ? genFontFamily({ locale, prepend: [userFontFamily, customFontFamily] })
      : undefined,
  fontFamilyCode: hasFont(userFontFamilyCode)
    ? genFontFamilyCode({ locale, prepend: [userFontFamilyCode] })
    : undefined,
});
