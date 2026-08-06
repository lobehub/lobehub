// the code below can only be modified with commercial license
// if you want to use it in the commercial usage
// please contact us for more information: hello@lobehub.com

const readBrandingEnv = (name: string, fallback: string) => {
  const publicKey = `NEXT_PUBLIC_${name}`;
  const value = process.env[name] ?? process.env[publicKey];

  return value?.trim() || fallback;
};

/** Default product name shown across the UI, metadata, and API client headers. */
export const BRANDING_NAME = readBrandingEnv('BRANDING_NAME', 'Panachat');

/**
 * Persian display name for fa-* locales (UI copy, logos, i18n `{{appName}}`).
 * Falls back to {@link BRANDING_NAME} when unset.
 */
export const BRANDING_NAME_FA = readBrandingEnv('BRANDING_NAME_FA', 'پاناچت');

/** Organization / legal entity name used in copyright and structured data. */
export const ORG_NAME = readBrandingEnv('ORG_NAME', BRANDING_NAME);

/** Persian organization name for fa-* locales. */
export const ORG_NAME_FA = readBrandingEnv('ORG_NAME_FA', BRANDING_NAME_FA);

/** Hosted cloud offering name, e.g. "Panachat Cloud". */
export const BRANDING_CLOUD_NAME = readBrandingEnv('BRANDING_CLOUD_NAME', `${BRANDING_NAME} Cloud`);

/** Persian cloud offering name for fa-* locales. */
export const BRANDING_CLOUD_NAME_FA = readBrandingEnv(
  'BRANDING_CLOUD_NAME_FA',
  `ابر ${BRANDING_NAME_FA}`,
);

/** @deprecated Use {@link BRANDING_CLOUD_NAME} instead. */
export const LOBE_CHAT_CLOUD = BRANDING_CLOUD_NAME;

/** Public marketing / docs site URL (defaults to APP_URL when unset). */
export const BRANDING_SITE_URL = readBrandingEnv('BRANDING_SITE_URL', '');

/** Product logo URL used by ProductLogo / metadata. Defaults to the favicon_io PWA icon. */
export const BRANDING_LOGO_URL = readBrandingEnv('BRANDING_LOGO_URL', '/icons/icon-192x192.png');

export const BRANDING_URL = {
  help: undefined,
  privacy: undefined,
  subscription: undefined,
  support: undefined,
  terms: undefined,
};

export const SOCIAL_URL = {
  discord: undefined,
  github: undefined,
  medium: undefined,
  x: undefined,
  youtube: undefined,
};

export const FILE_URL = {
  importFromNotionGuide: undefined,
};

export const BRANDING_EMAIL = {
  business: readBrandingEnv('BRANDING_BUSINESS_EMAIL', ''),
  replyTo: undefined,
  support: readBrandingEnv('BRANDING_SUPPORT_EMAIL', ''),
};

export const BRANDING_PROVIDER = readBrandingEnv('BRANDING_PROVIDER', 'official');

export const APPLE_APP_STORE_ID = '';

export const COPYRIGHT = `© ${new Date().getFullYear()} ${ORG_NAME}`;
export const COPYRIGHT_FULL = `${COPYRIGHT}. All rights reserved.`;

/** True when the locale should use Persian brand strings. */
export const isPersianBrandingLocale = (locale?: string | null) =>
  Boolean(locale && (locale === 'fa-IR' || locale === 'fa' || locale.startsWith('fa-')));

/** Product display name for the given locale (Persian → پاناچت). */
export const getLocalizedBrandingName = (locale?: string | null) =>
  isPersianBrandingLocale(locale) ? BRANDING_NAME_FA : BRANDING_NAME;

/** Default inbox assistant title, e.g. "Panachat AI". */
export const BRANDING_INBOX_NAME = `${BRANDING_NAME} AI`;

/** Persian inbox assistant title for fa-* locales. */
export const BRANDING_INBOX_NAME_FA = `${BRANDING_NAME_FA} AI`;

/** Inbox assistant display name for the given locale. */
export const getLocalizedBrandingInboxName = (locale?: string | null) =>
  isPersianBrandingLocale(locale) ? BRANDING_INBOX_NAME_FA : BRANDING_INBOX_NAME;

/** Organization display name for the given locale. */
export const getLocalizedOrgName = (locale?: string | null) =>
  isPersianBrandingLocale(locale) ? ORG_NAME_FA : ORG_NAME;

/** Cloud offering display name for the given locale. */
export const getLocalizedBrandingCloudName = (locale?: string | null) =>
  isPersianBrandingLocale(locale) ? BRANDING_CLOUD_NAME_FA : BRANDING_CLOUD_NAME;
