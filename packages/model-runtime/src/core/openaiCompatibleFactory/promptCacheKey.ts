import { sha256 } from 'js-sha256';

/** OpenAI-compatible providers reject `prompt_cache_key` values longer than this. */
export const PROMPT_CACHE_KEY_MAX_LENGTH = 64;

const PROMPT_CACHE_KEY_PREFIX = 'lobe:';

const matchesProviderPromptCacheModel = (
  model: string,
  promptCacheKeyModels?: Array<RegExp | string>,
) =>
  (promptCacheKeyModels ?? []).some((item) => {
    if (typeof item === 'string') return model.includes(item);

    item.lastIndex = 0;
    return item.test(model);
  });

/**
 * Resolve the automatic `prompt_cache_key` for a request.
 *
 * Short keys keep the readable `lobe:{user}:{model}` form. Keys that would exceed
 * the provider limit are replaced by a truncated SHA-256 digest of the structured
 * `[user, model]` identity: the result stays deterministic and bounded while still
 * encoding the full scope, so different users or models never collapse onto the
 * same bucket.
 */
export const resolvePromptCacheKey = (
  model?: string,
  user?: string,
  promptCacheKeyModels?: Array<RegExp | string>,
): string | undefined => {
  if (!user) return;

  // OpenAI `gpt-*`, `o*` and `chat-latest` models are handled by the factory
  // default; every other provider has to opt in through `promptCacheKeyModels`.
  const supportsPromptCacheKey =
    !!model?.startsWith('gpt-') ||
    /^o\d/.test(model || '') ||
    model === 'chat-latest' ||
    (!!model && matchesProviderPromptCacheModel(model, promptCacheKeyModels));

  if (!supportsPromptCacheKey) return;

  const key = `${PROMPT_CACHE_KEY_PREFIX}${user}:${model}`;
  if (key.length <= PROMPT_CACHE_KEY_MAX_LENGTH) return key;

  // `JSON.stringify` keeps the user/model boundary unambiguous even when either
  // part contains ":"; the digest is shortened so `lobe:` plus it still fits.
  const digest = sha256(JSON.stringify([user, model])).slice(
    0,
    PROMPT_CACHE_KEY_MAX_LENGTH - PROMPT_CACHE_KEY_PREFIX.length,
  );

  return `${PROMPT_CACHE_KEY_PREFIX}${digest}`;
};
