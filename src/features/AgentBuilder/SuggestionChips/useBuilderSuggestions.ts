import { TRACING_SCENARIOS } from '@lobechat/const';
import {
  BUILDER_SUGGESTION_PROMPT_VERSION,
  BUILDER_SUGGESTION_SCHEMA_NAME,
  type BuilderSuggestionItem,
  type BuilderSuggestionMode,
  chainBuilderSuggestion,
} from '@lobechat/prompts';
import { useCallback, useEffect, useRef, useState } from 'react';
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

interface BuilderSuggestionRequest {
  builderAgentId: string;
  contextSummary: string;
  mode: BuilderSuggestionMode;
  nonce: number;
  targetId?: string;
}

type BuilderSuggestionTarget = Pick<
  BuilderSuggestionRequest,
  'builderAgentId' | 'mode' | 'targetId'
>;

const createSuggestionRequest = ({
  builderAgentId,
  contextSummary,
  mode,
  nonce,
  targetId,
}: BuilderSuggestionRequest): BuilderSuggestionRequest => ({
  builderAgentId,
  contextSummary,
  mode,
  nonce,
  targetId,
});

const isSameSuggestionTarget = (
  request: BuilderSuggestionRequest | undefined,
  { builderAgentId, mode, targetId }: BuilderSuggestionTarget,
) =>
  request?.builderAgentId === builderAgentId &&
  request.mode === mode &&
  request.targetId === targetId;

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
  const latestContextSummaryRef = useRef(contextSummary);
  latestContextSummaryRef.current = contextSummary;

  const [request, setRequest] = useState<BuilderSuggestionRequest | undefined>(() =>
    enabled && contextSummary
      ? createSuggestionRequest({ builderAgentId, contextSummary, mode, nonce: 0, targetId })
      : undefined,
  );
  const markRegenerated = useBuilderSuggestionFeedbackStore((s) => s.markRegenerated);

  useEffect(() => {
    if (!enabled || !contextSummary) return;

    setRequest((previousRequest) => {
      if (isSameSuggestionTarget(previousRequest, { builderAgentId, mode, targetId })) {
        return previousRequest;
      }

      return createSuggestionRequest({ builderAgentId, contextSummary, mode, nonce: 0, targetId });
    });
  }, [builderAgentId, contextSummary, enabled, mode, targetId]);

  const key =
    enabled && request && model && provider
      ? ([
          'builder-suggestion',
          request.mode,
          request.builderAgentId,
          request.targetId,
          request.contextSummary,
          request.nonce,
        ] as const)
      : null;

  const { data, isLoading, error } = useSWR(
    key,
    async ([, requestMode, requestBuilderAgentId, , requestContextSummary]) => {
      const { messages, schema } = chainBuilderSuggestion({
        contextSummary: requestContextSummary,
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
    const latestContextSummary = latestContextSummaryRef.current;
    if (!enabled || !latestContextSummary) return;

    setRequest((previousRequest) =>
      createSuggestionRequest({
        builderAgentId,
        contextSummary: latestContextSummary,
        mode,
        nonce: isSameSuggestionTarget(previousRequest, { builderAgentId, mode, targetId })
          ? previousRequest!.nonce + 1
          : 1,
        targetId,
      }),
    );
  }, [builderAgentId, data?.tracingId, enabled, markRegenerated, mode, targetId]);

  return {
    error,
    isLoading: !!key && isLoading,
    refresh,
    suggestions: data?.suggestions ?? [],
    tracingId: data?.tracingId,
  };
};
