import { BRANDING_PROVIDER } from './branding';

export * from './branding';
export * from './llm';
export * from './url';

export const ENABLE_BUSINESS_FEATURES = false;

/**
 * Master switch for the (now removed) conversational agent-onboarding flow.
 *
 * Soft-disabled: kept in the codebase but permanently off. No client code
 * reads this anymore now that the agent-onboarding flow has been deleted.
 */
export const AGENT_ONBOARDING_ENABLED = false;

/**
 * Prefix on every issued API key.
 *
 * Users see and paste this string, so on a white-label distribution it is the
 * most directly visible piece of vendor branding there is — it travels in
 * support tickets, `.env` files and screenshots long after the UI has been
 * rebranded.
 *
 * It is also load-bearing: `validateApiKeyFormat` is what the OpenAPI auth
 * middleware uses to tell an API key from an OIDC JWT, so generation and
 * validation must read the SAME constant or every key stops authenticating.
 *
 * Changing it does NOT migrate keys already in the database — those stop
 * matching the format check and are rejected as malformed. A distribution that
 * has issued keys should accept both spellings for a period instead.
 */
export const API_KEY_PREFIX = 'sk-lh-';

export const OFFICIAL_PROVIDER_DISABLE_ERROR = 'The official provider cannot be disabled.';

export const isOfficialProvider = (id: string) =>
  ENABLE_BUSINESS_FEATURES && id === BRANDING_PROVIDER;
