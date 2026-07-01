import { TRACING_SCENARIOS } from '@lobechat/const';
import {
  BUILDER_SUGGESTION_PROMPT_VERSION,
  BUILDER_SUGGESTION_SCHEMA_NAME,
  type BuilderSuggestionItem,
  type BuilderSuggestionMode,
  chainBuilderSuggestion,
} from '@lobechat/prompts';
import { useCallback, useState } from 'react';
import useSWR from 'swr';

import { swrKeys } from '@/libs/swr/keys';
import { aiChatService } from '@/services/aiChat';

import { useBuilderSuggestionFeedbackStore } from './feedbackStore';

interface UseBuilderSuggestionsParams {
  /** Builtin builder agent id — drives the model and is recorded as `agentId`. */
  builderAgentId: string;
  contextSummary: string;
  enabled: boolean;
  locale?: string;
  mode: BuilderSuggestionMode;
  model: string;
  provider: string;
  /** Agent/group currently being edited. Config autosaves for the same target must not regenerate. */
  targetId?: string;
}

interface BuilderSuggestionsResult {
  error: unknown;
  isLoading: boolean;
  /** Discards the current batch (negative signal) and generates a fresh one. */
  refresh: () => void;
  suggestions: BuilderSuggestionItem[];
  tracingId?: string;
}

type GenerateEnvelope = {
  data?: { suggestions?: BuilderSuggestionItem[] } | null;
  tracingId?: string;
} | null;

export const useBuilderSuggestions = ({
  mode,
  builderAgentId,
  contextSummary,
  model,
  provider,
  locale,
  enabled,
  targetId,
}: UseBuilderSuggestionsParams): BuilderSuggestionsResult => {
  // Bumping the nonce forces a fresh generation (SWR key change) on manual refresh.
  const [nonce, setNonce] = useState(0);
  const markRegenerated = useBuilderSuggestionFeedbackStore((s) => s.markRegenerated);

  // Key on target identity only — the context summary is deliberately kept out of
  // the key so config autosaves (which stream in new summaries for the same target)
  // don't refetch. Only a target switch or a nonce bump regenerates; the fetcher
  // closure reads the current summary, which is always the latest value on the
  // render that changes the key.
  const key =
    enabled && contextSummary && model && provider
      ? swrKeys.agentBuilder.suggestions(mode, builderAgentId, targetId, nonce)
      : null;

  const { data, isLoading, error } = useSWR(
    key,
    async () => {
      // Read mode/context/agent from the closure: SWR runs the fetcher from the
      // render that changed the key, so these already hold the latest values.
      const { messages, schema } = chainBuilderSuggestion({ contextSummary, locale, mode });
      const abortController = new AbortController();
      const envelope = (await aiChatService.generateJSON(
        {
          messages,
          model,
          provider,
          schema,
          tracing: {
            agentId: builderAgentId,
            promptVersion: BUILDER_SUGGESTION_PROMPT_VERSION,
            scenario: TRACING_SCENARIOS.BuilderSuggestion,
            schemaName: BUILDER_SUGGESTION_SCHEMA_NAME,
          },
        },
        abortController,
      )) as GenerateEnvelope;

      const suggestions = (envelope?.data?.suggestions ?? [])
        .filter((s) => s?.title?.trim() && s?.prompt?.trim())
        .slice(0, 3);

      return { suggestions, tracingId: envelope?.tracingId };
    },
    {
      dedupingInterval: 600_000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    },
  );

  const refresh = useCallback(() => {
    markRegenerated(data?.tracingId);
    setNonce((n) => n + 1);
  }, [data?.tracingId, markRegenerated]);

  return {
    error,
    isLoading: !!key && isLoading,
    refresh,
    suggestions: data?.suggestions ?? [],
    tracingId: data?.tracingId,
  };
};
