export const BRANDING_CLOUD_NAME = 'Aico Cloud';
export const BRANDING_LOGO_URL = '/icons/icon-192x192.png';
export const BRANDING_NAME = 'Aico';
export const LOBE_CHAT_CLOUD = BRANDING_CLOUD_NAME;
export const DEFAULT_EMBEDDING_PROVIDER = 'openai';
export const DEFAULT_MINI_MODEL = 'gpt-5.4-mini';
export const DEFAULT_MINI_PROVIDER = 'openai';
export const DEFAULT_MODEL = 'deepseek-v4-pro';
export const DEFAULT_ONBOARDING_MODEL = 'gemini-3-flash-preview';
export const DEFAULT_ONBOARDING_PROVIDER = 'google';
export const DEFAULT_PROVIDER = 'deepseek';
export const ORG_NAME = 'Aico';
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
