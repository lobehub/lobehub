import { isRtlLang } from 'rtl-detect';

import { type Locales, locales } from '../../../../packages/locales/src/resources';

export type AcceptanceEmbedTheme = 'dark' | 'light';

export interface AcceptanceEmbedConfig {
  embed: boolean;
  theme?: AcceptanceEmbedTheme;
}

export interface AcceptanceConfigureMessage {
  locale: Locales;
  theme: AcceptanceEmbedTheme;
  type: 'lobehub:acceptance:configure';
}

const acceptanceDetailPattern = /^\/acceptance\/[^/]+\/?$/;

export const parseAcceptanceEmbedConfig = (url: string | URL): AcceptanceEmbedConfig => {
  const parsed = typeof url === 'string' ? new URL(url) : url;
  const embed =
    acceptanceDetailPattern.test(parsed.pathname) && parsed.searchParams.get('embed') === '1';
  const theme = parsed.searchParams.get('theme');

  return {
    embed,
    theme: embed && (theme === 'dark' || theme === 'light') ? theme : undefined,
  };
};

export const getReferrerOrigin = (referrer: string): string | undefined => {
  if (!referrer) return undefined;

  try {
    const url = new URL(referrer);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
};

export const parseAcceptanceConfigureMessage = (
  event: Pick<MessageEvent, 'data' | 'origin' | 'source'>,
  parentWindow: Window,
  trustedOrigin?: string,
): AcceptanceConfigureMessage | undefined => {
  if (!trustedOrigin || event.source !== parentWindow || event.origin !== trustedOrigin) return;
  if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return;

  const { locale, theme, type } = event.data as Record<string, unknown>;
  if (
    type !== 'lobehub:acceptance:configure' ||
    (theme !== 'dark' && theme !== 'light') ||
    typeof locale !== 'string'
  )
    return;

  const supportedLocale = locales.find(
    (supported) =>
      supported.toLowerCase() === locale.toLowerCase() ||
      supported.toLowerCase().startsWith(`${locale.toLowerCase()}-`),
  );
  if (!supportedLocale) return;

  return { locale: supportedLocale, theme, type };
};

export const applyAcceptanceConfiguration = (
  config: AcceptanceConfigureMessage,
  element: Pick<HTMLElement, 'dir' | 'lang'>,
  update: (config: Pick<AcceptanceConfigureMessage, 'locale' | 'theme'>) => void,
) => {
  element.lang = config.locale;
  element.dir = isRtlLang(config.locale) ? 'rtl' : 'ltr';
  update(config);
};
