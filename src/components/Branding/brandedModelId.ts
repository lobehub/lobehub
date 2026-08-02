import { BRANDING_NAME } from '@lobechat/business-const';

import { isCustomBranding } from '@/const/version';

const OPENROUTER_MODEL_PREFIX = 'openrouter/';

/** Slug used in UI model ids, e.g. `aico` from branding name `Aico`. */
export const getBrandingModelSlug = (): string => BRANDING_NAME.trim().toLowerCase();

/**
 * True when this model id is an OpenRouter-namespace id that should show as our brand
 * (e.g. `openrouter/auto` → `aico/auto` + ProductLogo).
 */
export const isBrandedOpenRouterModelId = (modelId: string): boolean =>
  isCustomBranding && modelId.toLowerCase().startsWith(OPENROUTER_MODEL_PREFIX);

/** Display-only id; runtime/API ids stay `openrouter/...`. */
export const formatBrandedModelId = (modelId: string): string => {
  if (!isBrandedOpenRouterModelId(modelId)) return modelId;
  return `${getBrandingModelSlug()}/${modelId.slice(OPENROUTER_MODEL_PREFIX.length)}`;
};
