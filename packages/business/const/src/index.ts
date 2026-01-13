export * from './bedrock-model-mapping';
export * from './branding';
export * from './llm';
export * from './url';

export const ENABLE_BUSINESS_FEATURES = false;
export const ENABLE_TOPIC_LINK_SHARE =
  ENABLE_BUSINESS_FEATURES ||
  (process.env.NODE_ENV === 'development' && !!process.env.NEXT_PUBLIC_ENABLE_TOPIC_LINK_SHARE);
