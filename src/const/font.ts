const FONT_EN = [
  'Geist',
  '-apple-system',
  'BlinkMacSystemFont',
  'Segoe UI Variable Display',
  'Segoe UI',
  'Roboto',
  'Helvetica Neue',
  'Arial',
];

const FONT_SC = [
  'HarmonyOS Sans SC',
  'PingFang SC',
  'Hiragino Sans GB',
  'Microsoft YaHei UI',
  'Microsoft YaHei',
  'Source Han Sans SC',
  'Noto Sans CJK SC',
];

const FONT_TC = [
  'PingFang TC',
  'Hiragino Sans CNS',
  'Microsoft JhengHei UI',
  'Microsoft JhengHei',
  'Source Han Sans TC',
  'Noto Sans CJK TC',
];

const FONT_JP = [
  'Hiragino Sans',
  'Hiragino Kaku Gothic ProN',
  'Yu Gothic UI',
  'Yu Gothic',
  'Meiryo',
  'Source Han Sans JP',
  'Noto Sans CJK JP',
];

const FONT_KR = ['Apple SD Gothic Neo', 'Malgun Gothic', 'Source Han Sans KR', 'Noto Sans CJK KR'];

const FONT_CODE = [
  'Geist Mono',
  'ui-monospace',
  'SFMono-Regular',
  'SF Mono',
  'Menlo',
  'Cascadia Code',
  'Consolas',
  'Liberation Mono',
];

const FALLBACK = ['ui-sans-serif', 'system-ui', 'sans-serif'];

const FALLBACK_CODE = ['monospace'];

const FONT_EMOJI = ['Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'];

// Han glyphs differ per region, so the locale's own CJK family must win over the
// SC families that stay in the stack as the last-resort CJK fallback.
const LOCALE_CJK_FONTS: Record<string, string[]> = {
  'ja-JP': FONT_JP,
  'ko-KR': FONT_KR,
  'zh-TW': FONT_TC,
};

// user / env values may already be a full CSS font-family list, so leave those alone
const quote = (font: string) =>
  font.includes(',') || font.includes('"') || !font.includes(' ') ? font : `"${font}"`;

interface GenFontFamilyParams {
  customFontFamily?: string;
  locale?: string;
  userFontFamily?: string;
}

export const genFontFamily = ({
  customFontFamily,
  locale,
  userFontFamily,
}: GenFontFamilyParams = {}) =>
  [
    userFontFamily?.trim(),
    customFontFamily?.trim(),
    ...FONT_EN,
    ...(locale ? (LOCALE_CJK_FONTS[locale] ?? []) : []),
    ...FONT_SC,
    ...FALLBACK,
    ...FONT_EMOJI,
  ]
    .filter(Boolean)
    .map((font) => quote(font as string))
    .join(',');

export const genFontFamilyCode = ({ locale, userFontFamily }: GenFontFamilyParams = {}) =>
  [
    userFontFamily?.trim(),
    ...FONT_CODE,
    ...(locale ? (LOCALE_CJK_FONTS[locale] ?? []) : []),
    ...FONT_SC,
    ...FALLBACK_CODE,
    ...FONT_EMOJI,
  ]
    .filter(Boolean)
    .map((font) => quote(font as string))
    .join(',');
