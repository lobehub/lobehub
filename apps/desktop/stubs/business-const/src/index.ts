export const BRANDING_CLOUD_NAME = 'Panachat Cloud';
export const BRANDING_CLOUD_NAME_FA = 'ابر پاناچت';
export const BRANDING_LOGO_URL = '/icons/icon-192x192.png';
export const BRANDING_NAME = 'Panachat';
export const BRANDING_NAME_FA = 'پاناچت';
export const BRANDING_INBOX_NAME = `${BRANDING_NAME} AI`;
export const BRANDING_INBOX_NAME_FA = `${BRANDING_NAME_FA} AI`;
export const LOBE_CHAT_CLOUD = BRANDING_CLOUD_NAME;
export const DEFAULT_EMBEDDING_PROVIDER = 'openrouter';
export const DEFAULT_MINI_MODEL = 'openai/gpt-4o-mini';
export const DEFAULT_MINI_PROVIDER = 'openrouter';
export const DEFAULT_MODEL = 'openrouter/auto';
export const DEFAULT_ONBOARDING_MODEL = 'openrouter/auto';
export const DEFAULT_ONBOARDING_PROVIDER = 'openrouter';
export const DEFAULT_PROVIDER = 'openrouter';
export const ORG_NAME = 'Panachat';
export const ORG_NAME_FA = 'پاناچت';

export const isPersianBrandingLocale = (locale?: string | null) =>
  Boolean(locale && (locale === 'fa-IR' || locale === 'fa' || locale.startsWith('fa-')));

export const getLocalizedBrandingName = (locale?: string | null) =>
  isPersianBrandingLocale(locale) ? BRANDING_NAME_FA : BRANDING_NAME;

export const getLocalizedBrandingInboxName = (locale?: string | null) =>
  isPersianBrandingLocale(locale) ? BRANDING_INBOX_NAME_FA : BRANDING_INBOX_NAME;

export const getLocalizedOrgName = (locale?: string | null) =>
  isPersianBrandingLocale(locale) ? ORG_NAME_FA : ORG_NAME;

export const getLocalizedBrandingCloudName = (locale?: string | null) =>
  isPersianBrandingLocale(locale) ? BRANDING_CLOUD_NAME_FA : BRANDING_CLOUD_NAME;

// mirrored from packages/business/const — model-bank gates the LobeHub
// provider entry on this flag; the OSS desktop build keeps it off
export const ENABLE_BUSINESS_FEATURES = false;

// Re-export Aico error catalog so client imports stay resolvable in desktop stubs.
export {
  AICO_ERROR_ALIASES,
  AICO_ERROR_CODES,
  AICO_ERROR_MESSAGES_FA,
  isAicoErrorCode,
  normalizeAicoErrorCode,
  resolveAicoErrorCode,
} from '../../../../../packages/business/const/src/aicoErrors';
