import { BRANDING_PROVIDER } from './branding';

export * from './bedrock-model-mapping';
export * from './branding';
export * from './llm';
export * from './url';

const isDev = process.env.NODE_ENV === 'development';

export const ENABLE_BUSINESS_FEATURES = false;

export const AGENT_ONBOARDING_ENABLED = isDev;

export const OFFICIAL_PROVIDER_DISABLE_ERROR = 'The official provider cannot be disabled.';

export const isOfficialProvider = (id: string) =>
  ENABLE_BUSINESS_FEATURES && id === BRANDING_PROVIDER;
