import { BRANDING_NAME } from '@lobechat/business-const';

import { isCustomBranding } from '@/const/version';

/** Slug used in UI model ids, e.g. `aico` from branding name `Aico`. */
export const getBrandingModelSlug = (): string => BRANDING_NAME.trim().toLowerCase();

/**
 * True when this model id is an OpenRouter-namespace id that should show as our brand
 * (e.g. `openrouter/auto` → `aico/auto` + ProductLogo).
 * Matches ModelIcon's `^openrouter` keyword so any OpenRouter-owned id is branded.
 */
export const isBrandedOpenRouterModelId = (modelId: string): boolean =>
  Boolean(isCustomBranding && modelId && /^openrouter\b/i.test(modelId));

/** Display-only id; runtime/API ids stay `openrouter/...`. */
export const formatBrandedModelId = (modelId: string): string => {
  if (!isBrandedOpenRouterModelId(modelId)) return modelId;
  const rest = modelId.replace(/^openrouter\/?/i, '');
  return rest ? `${getBrandingModelSlug()}/${rest}` : getBrandingModelSlug();
};

/** True when this runtime provider id should show as product brand in the UI. */
export const isBrandedOpenRouterProvider = (provider?: string): boolean =>
  Boolean(isCustomBranding && provider && /^openrouter$/i.test(provider.trim()));

/** Display-only provider label; runtime/API ids stay `openrouter`. */
export const formatBrandedProviderId = (provider: string): string => {
  if (!isBrandedOpenRouterProvider(provider)) return provider;
  return BRANDING_NAME;
};
