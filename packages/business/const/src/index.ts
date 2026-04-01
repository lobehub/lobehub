export * from './bedrock-model-mapping';
export * from './branding';
export * from './llm';
export * from './url';

const isDev = process.env.NODE_ENV === 'development';

export const ENABLE_BUSINESS_FEATURES = false;

export const AGENT_ONBOARDING_ENABLED = isDev;
