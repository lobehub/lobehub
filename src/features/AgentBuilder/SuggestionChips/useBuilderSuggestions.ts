import { TRACING_SCENARIOS } from '@lobechat/const';
import {
  BUILDER_SUGGESTION_PROMPT_VERSION,
  BUILDER_SUGGESTION_SCHEMA_NAME,
  type BuilderSuggestionItem,
  type BuilderSuggestionMode,
  chainBuilderSuggestion,
} from '@lobechat/prompts';
import { useCallback, useRef, useState } from 'react';
import useSWR from 'swr';

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

  // The context summary is deliberately NOT part of the SWR key: config autosaves
  // stream in new summaries for the same target and must not trigger a refetch.
  // We read the latest value from a ref at fetch time so target switches and
  // manual refreshes (both change the key) always generate from fresh context.
  const latestContextSummaryRef = useRef(contextSummary);
  latestContextSummaryRef.current = contextSummary;

  // Key on target identity only — a target switch or a nonce bump regenerates;
  // autosaves that merely change the summary do not.
  const key =
    enabled && contextSummary && model && provider
      ? (['builder-suggestion', mode, builderAgentId, targetId, nonce] as const)
      : null;

  const { data, isLoading, error } = useSWR(
    key,
    async ([, requestMode, requestBuilderAgentId]) => {
      const { messages, schema } = chainBuilderSuggestion({
        contextSummary: latestContextSummaryRef.current,
        locale,
        mode: requestMode,
      });
      const abortController = new AbortController();
      const envelope = (await aiChatService.generateJSON(
        {
          messages,
          model,
          provider,
          schema,
          tracing: {
            agentId: requestBuilderAgentId,
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
