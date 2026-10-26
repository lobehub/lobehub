'use client';

import isEqual from 'fast-deep-equal';
import type {
  AiModelReasoningConfig,
  AiModelReasoningEffortSettings,
  ReasoningEffortLevel,
} from 'model-bank';
import { REASONING_MODES, resolveReasoningEffortLevel } from 'model-bank/aiModel';
import { useCallback } from 'react';

import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';

type ReasoningMode = NonNullable<AiModelReasoningConfig['reasoningMode']>;

export interface ReasoningEffortControl {
  /** The levels of the model's effort control; empty when it has none. */
  effortLevels: readonly ReasoningEffortLevel[];
  effortValue?: ReasoningEffortLevel;
  hasEffort: boolean;
  hasReasoningMode: boolean;
  /** False when the model exposes neither an effort level nor a reasoning mode. */
  hasReasoningParams: boolean;
  modeLevels: readonly ReasoningMode[];
  modeValue: ReasoningMode;
  select: (patch: AiModelReasoningConfig) => void;
  updating: boolean;
}

/**
 * The effort level a model runs at: the saved pick when the card still offers
 * it, otherwise the card default — the same level the runtime sends.
 */
export const resolveReasoningEffortValue = (
  settings: AiModelReasoningEffortSettings | undefined,
  config: AiModelReasoningConfig | undefined,
): ReasoningEffortLevel | undefined =>
  settings ? resolveReasoningEffortLevel(settings, config?.reasoningEffort) : undefined;

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
    aiModelSelectors.isModelHasReasoningControls(model, provider),
  );
  const effortSettings = useAiInfraStore(
    aiModelSelectors.modelReasoningEffortSettings(model, provider),
    isEqual,
  );
  const hasReasoningMode = useAiInfraStore(
    aiModelSelectors.isModelHasReasoningMode(model, provider),
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
  const modelUpdating = useAiInfraStore(
    aiModelSelectors.isModelReasoningConfigUpdating(model, provider),
  );
  const topicUpdating = useChatStore(
    (s) => !!topicId && s.topicEffortUpdatingIds.includes(topicId),
  );
  const updating = topicId ? topicUpdating : modelUpdating;
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

  return {
    effortLevels: effortSettings?.levels ?? [],
    effortValue: resolveReasoningEffortValue(effortSettings, config),
    hasEffort: !!effortSettings,
    hasReasoningMode,
    hasReasoningParams,
    modeLevels: REASONING_MODES,
    modeValue: config?.reasoningMode ?? 'standard',
    select,
    updating,
  };
};
