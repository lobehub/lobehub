import { BRANDING_NAME } from './branding';

/** Pinned OpenRouter auto-router id (UI brands as `{BRANDING_NAME}/auto`, e.g. panachat/auto). */
export const OPENROUTER_AUTO_MODEL_ID = 'openrouter/auto';

/** Display name for the pinned auto router (product brand, not OpenRouter). */
export const OPENROUTER_AUTO_DISPLAY_NAME = `${BRANDING_NAME} Auto`;

/** OpenRouter id prefixes treated as default-enabled families (ChatGPT / Claude / Gemini). */
export const OPENROUTER_DEFAULT_ENABLED_FAMILIES = ['openai', 'anthropic', 'google'] as const;

export type OpenRouterDefaultEnabledFamily = (typeof OPENROUTER_DEFAULT_ENABLED_FAMILIES)[number];

/** How many newest chat models to enable per family by default. */
export const DEFAULT_ENABLED_MODELS_PER_FAMILY = 4;

export type OpenRouterDefaultModelCandidate = {
  id: string;
  releasedAt?: string | null;
  type?: string | null;
};

const familyOf = (id: string): OpenRouterDefaultEnabledFamily | null => {
  const slash = id.indexOf('/');
  if (slash <= 0) return null;
  const prefix = id.slice(0, slash);
  return (OPENROUTER_DEFAULT_ENABLED_FAMILIES as readonly string[]).includes(prefix)
    ? (prefix as OpenRouterDefaultEnabledFamily)
    : null;
};

const isChatType = (type?: string | null): boolean => {
  const normalized = (type || 'chat').toLowerCase();
  return normalized === 'chat';
};

/**
 * Returns the set of OpenRouter model ids that should be enabled by default:
 * always includes {@link OPENROUTER_AUTO_MODEL_ID}, plus the
 * {@link DEFAULT_ENABLED_MODELS_PER_FAMILY} newest chat models from each of
 * openai / anthropic / google (by `releasedAt` desc; missing dates sort last).
 */
export const computeDefaultEnabledOpenRouterModelIds = (
  models: OpenRouterDefaultModelCandidate[],
  perFamily: number = DEFAULT_ENABLED_MODELS_PER_FAMILY,
): Set<string> => {
  const buckets = new Map<OpenRouterDefaultEnabledFamily, OpenRouterDefaultModelCandidate[]>();

  for (const family of OPENROUTER_DEFAULT_ENABLED_FAMILIES) {
    buckets.set(family, []);
  }

  for (const model of models) {
    if (!isChatType(model.type)) continue;
    const family = familyOf(model.id);
    if (!family) continue;
    buckets.get(family)!.push(model);
  }

  // Always pin product Auto — even if the upstream snapshot omitted it.
  const enabled = new Set<string>([OPENROUTER_AUTO_MODEL_ID]);

  for (const family of OPENROUTER_DEFAULT_ENABLED_FAMILIES) {
    const ranked = buckets.get(family)!.toSorted((a, b) => {
      const aDate = a.releasedAt?.slice(0, 10) || '';
      const bDate = b.releasedAt?.slice(0, 10) || '';
      if (aDate && bDate && aDate !== bDate) return bDate.localeCompare(aDate);
      if (aDate && !bDate) return -1;
      if (!aDate && bDate) return 1;
      return a.id.localeCompare(b.id);
    });

    for (const model of ranked.slice(0, perFamily)) {
      enabled.add(model.id);
    }
  }

  return enabled;
};

/**
 * Prefer product Auto, then newest OpenAI / Anthropic / Google from the default-enabled set.
 */
export const pickPreferredDefaultOpenRouterModelId = (
  enabledIds: Iterable<string>,
): string | null => {
  const ids = [...enabledIds];
  if (ids.includes(OPENROUTER_AUTO_MODEL_ID)) return OPENROUTER_AUTO_MODEL_ID;
  for (const family of OPENROUTER_DEFAULT_ENABLED_FAMILIES) {
    const prefix = `${family}/`;
    const match = ids.find((id) => id.startsWith(prefix));
    if (match) return match;
  }
  return null;
};

/** Ensure the Auto router card exists in a catalog snapshot (inject if missing). */
export const ensureOpenRouterAutoModel = <T extends { id: string }>(
  models: T[],
  autoCard: T,
): T[] => {
  if (models.some((m) => m.id === OPENROUTER_AUTO_MODEL_ID)) return models;
  return [autoCard, ...models];
};
