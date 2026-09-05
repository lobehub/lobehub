'use client';

import isEqual from 'fast-deep-equal';
import type { AiModelReasoningConfig } from 'model-bank';
import { MODEL_REASONING_PARAM_DEFAULTS, MODEL_REASONING_PARAM_LEVELS } from 'model-bank';
import { useCallback } from 'react';

import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';

type EffortKey = Exclude<keyof AiModelReasoningConfig, 'reasoningMode'>;
/** Every level any effort-family param can take — all have a `reasoningEffort.levels.*` label. */
type EffortLevel = NonNullable<AiModelReasoningConfig[EffortKey]>;
type ReasoningMode = NonNullable<AiModelReasoningConfig['reasoningMode']>;

export interface ReasoningEffortControl {
  /** The single effort-family extend param this model exposes, if any. */
  effortKey?: EffortKey;
  effortLevels: readonly EffortLevel[];
  effortValue?: EffortLevel;
  hasReasoningMode: boolean;
  /** False when the model exposes neither an effort level nor a reasoning mode. */
  hasReasoningParams: boolean;
  modeLevels: readonly ReasoningMode[];
  modeValue: ReasoningMode;
  select: (patch: AiModelReasoningConfig) => void;
  updating: boolean;
}

/**
 * Reasoning effort / mode for one model instance.
 *
 * Two scopes, mirroring the model pin (`ChatTopic.model`):
 * - With `topicId` (chat input while a topic is active): reads and writes the
 *   topic's own pin (`ChatTopicMetadata.reasoningConfig`), so one session can
 *   run at a higher effort without retuning anything else. The pin only
 *   applies when it was taken for this very model; otherwise the user-level
 *   value shows and the first pick seeds a pin from it.
 * - Without `topicId` (new conversation, agent profile): the user-level
 *   model-instance setting (userId + providerId + modelId, personal scope) —
 *   not part of the agent's chatConfig, so it follows the user across agents
 *   and stays writable for chat-only members. It is also what a new topic
 *   snapshots.
 *
 * The saved user-level defaults are fetched by ReasoningConfigLoader (mounted
 * in ChatInputProvider), so every control built on this hook and the send
 * pipeline (modelParamsResolver) read the same store value.
 */
export const useReasoningEffortControl = (
  model: string,
  provider: string,
  topicId?: string,
): ReasoningEffortControl => {
  const hasReasoningParams = useAiInfraStore(
    aiModelSelectors.isModelHasReasoningExtendParams(model, provider),
  );
  const reasoningParams = useAiInfraStore(
    aiModelSelectors.modelReasoningExtendParams(model, provider),
    isEqual,
  );
  const userConfig = useAiInfraStore(
    aiModelSelectors.modelReasoningConfig(model, provider),
    isEqual,
  );
  const topicConfig = useChatStore(
    (s) =>
      topicId
        ? topicSelectors.getTopicReasoningConfigForModel(topicId, model, provider)(s)
        : undefined,
    isEqual,
  );
  const config = topicConfig ?? userConfig;
  const updating = useAiInfraStore(
    aiModelSelectors.isModelReasoningConfigUpdating(model, provider),
  );
  const updateModelReasoningConfig = useAiInfraStore((s) => s.updateModelReasoningConfig);
  const updateTopicReasoningConfig = useChatStore((s) => s.updateTopicReasoningConfig);

  const select = useCallback(
    (patch: AiModelReasoningConfig) => {
      if (updating) return;
      if (topicId) {
        // Seed a first-time pin from the user-level config so the topic keeps
        // e.g. the user's reasoning mode when only the effort was changed.
        void updateTopicReasoningConfig(topicId, patch, userConfig).catch(() => {});
        return;
      }
      // failure already rolls back and toasts inside the store action
      void updateModelReasoningConfig(model, provider, patch).catch(() => {});
    },
    [
      model,
      provider,
      topicId,
      updateModelReasoningConfig,
      updateTopicReasoningConfig,
      updating,
      userConfig,
    ],
  );

  // modelReasoningExtendParams only returns MODEL_REASONING_EXTEND_PARAMS
  // entries, so the narrowing cast is safe
  const effortKey = reasoningParams.find((param) => param !== 'reasoningMode') as
    EffortKey | undefined;
  const hasReasoningMode = reasoningParams.includes('reasoningMode');

  // Keep the same model-dependent fallback as the ControlsForm slider
  const effortDefault = effortKey
    ? effortKey === 'gpt5_2ReasoningEffort' && model === 'gpt-5.5'
      ? 'medium'
      : MODEL_REASONING_PARAM_DEFAULTS[effortKey]
    : undefined;

  return {
    effortKey,
    effortLevels: effortKey ? MODEL_REASONING_PARAM_LEVELS[effortKey] : [],
    effortValue: (effortKey && config?.[effortKey]) ?? effortDefault,
    hasReasoningMode,
    hasReasoningParams,
    modeLevels: MODEL_REASONING_PARAM_LEVELS.reasoningMode,
    modeValue: config?.reasoningMode ?? MODEL_REASONING_PARAM_DEFAULTS.reasoningMode,
    select,
    updating,
  };
};
