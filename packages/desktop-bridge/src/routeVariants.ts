// Shared route variants utilities for desktop and web builds

export const DEFAULT_LANG = 'en-US';

// Supported locales (keep aligned with web resources)
export const locales = [
  'ar',
  'bg-BG',
  'de-DE',
  'en-US',
  'es-ES',
  'fr-FR',
  'ja-JP',
  'ko-KR',
  'pt-BR',
  'ru-RU',
  'tr-TR',
  'zh-CN',
  'zh-TW',
  'vi-VN',
  'fa-IR',
  'it-IT',
  'pl-PL',
  'nl-NL',
] as const;

export type Locales = (typeof locales)[number];

export interface IRouteVariants {
  isMobile: boolean;
  locale: Locales;
  neutralColor?: string;
  primaryColor?: string;
}

export const DEFAULT_VARIANTS: IRouteVariants = {
  isMobile: false,
  locale: DEFAULT_LANG,
};

const SPLITTER = '__';

export class RouteVariants {
  static serializeVariants = (variants: IRouteVariants): string =>
    [variants.locale, Number(variants.isMobile)].join(SPLITTER);

  static deserializeVariants = (serialized: string): IRouteVariants => {
    try {
      const [locale, isMobile] = serialized.split(SPLITTER);

      return {
        isMobile: isMobile === '1',
        locale: RouteVariants.isValidLocale(locale) ? (locale as Locales) : DEFAULT_VARIANTS.locale,
      };
    } catch {
      return { ...DEFAULT_VARIANTS };
    }
  };

  static createVariants = (options: Partial<IRouteVariants> = {}): IRouteVariants => ({
    ...DEFAULT_VARIANTS,
    ...options,
  });

  private static isValidLocale = (locale: string): boolean => locales.includes(locale as any);
}
