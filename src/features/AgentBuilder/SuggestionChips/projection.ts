import type { BuilderSuggestionItem, BuilderSuggestionMode } from '@lobechat/prompts';

import type { AppLocalStorage } from '@/libs/replica';
import { cacheScope, defineReplica } from '@/libs/replica';

export interface BuilderSuggestionParams {
  /** Builtin builder agent id — drives the model and is recorded as `agentId`. */
  builderAgentId: string;
  /** Latest config summary. Not part of the key: autosaves must not regenerate. */
  contextSummary: string;
  locale?: string;
  mode: BuilderSuggestionMode;
  model: string;
  provider: string;
  /** Agent/group being edited. */
  targetId?: string;
}

/** One generated batch of opening chips and the tracing row that produced it. */
export interface BuilderSuggestionBatch {
  suggestions: BuilderSuggestionItem[];
  tracingId?: string;
}

/**
 * Entry identity: the edited target and the UI language (chips are generated
 * in it, so a language switch must miss). The context summary, model and
 * provider stay out, so config autosaves for the same target keep the batch.
 */
export const builderSuggestionKey = ({
  builderAgentId,
  locale,
  mode,
  targetId,
}: Pick<BuilderSuggestionParams, 'builderAgentId' | 'locale' | 'mode' | 'targetId'>) =>
  [mode, builderAgentId, targetId ?? '', locale ?? ''].join('\u0000');

/**
 * Builder opening-suggestion chips. Persisted so a revisit paints the last
 * batch on the first frame instead of paying a skeleton and an LLM generation
 * on every page load. Only titles, prompts and the tracing id are kept; one row
 * per edited target and locale, the least recently used evicted past the cap.
 *
 * The name deliberately matches no `CACHE_TIERS` pattern
 * (`agentBuilder:suggestions`), so the batch is persisted by the replica only.
 */
export const builderSuggestionResource = defineReplica<
  BuilderSuggestionParams,
  BuilderSuggestionBatch
>({
  key: builderSuggestionKey,
  name: 'agentBuilderSuggestions',
  persist: { maxEntries: 50 },
  storage: 'localStorage',
  version: 1,
});

/**
 * The persisted batch of an entry, read synchronously from the replica's own
 * localStorage row. The replica hydrates asynchronously, after the first paint;
 * this lets that first frame show the chips instead of a skeleton.
 */
export const peekBuilderSuggestions = (
  params: BuilderSuggestionParams,
  scope: string,
): BuilderSuggestionBatch | undefined => {
  if (!cacheScope.canHydrate?.()) return undefined;
  const storage = builderSuggestionResource.storage as
    AppLocalStorage<BuilderSuggestionBatch> | undefined;
  const data = storage?.getSync?.({
    queryKey: builderSuggestionResource.storageKey(params),
    scope,
  })?.data;
  return Array.isArray(data?.suggestions) ? data : undefined;
};
