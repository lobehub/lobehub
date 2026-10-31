import type { AiModelType } from 'model-bank';
import {
  type AiModelReasoningEffortSettings,
  createReasoningEffortSettings,
  type ReasoningEffortLevel,
} from 'model-bank/aiModel';

/**
 * Model types selectable when creating or editing a custom model.
 *
 * `image` and `video` are intentionally excluded: generation relies on a model-bank
 * `parameters` schema that this form cannot edit yet, so custom image/video models end up
 * schema-less and break model switching on the generation pages.
 */
export const CUSTOM_MODEL_TYPES: AiModelType[] = [
  'chat',
  'embedding',
  'tts',
  'asr',
  'text2music',
  'realtime',
  'decision',
];

export const hasDuplicateModelId = (id: string | undefined, existingModelIds: string[]) => {
  const modelId = id?.trim();
  if (!modelId) return false;

  return existingModelIds.includes(modelId);
};

/**
 * Rebuilds a custom model's effort control after its level checkboxes change.
 * Clearing every level removes the control; the chosen default is kept while
 * it is still offered, otherwise the middle level takes over.
 */
export const updateReasoningEffortLevels = (
  value: AiModelReasoningEffortSettings | undefined,
  levels: ReasoningEffortLevel[],
): AiModelReasoningEffortSettings | undefined => {
  if (levels.length === 0) return;

  const next = createReasoningEffortSettings(levels, {
    controlsThinking: value?.controlsThinking,
  });
  if (value && next.levels.includes(value.default)) next.default = value.default;
  return next;
};

/** Sets whether the effort also switches thinking (`controlsThinking`). */
export const setReasoningEffortControlsThinking = (
  value: AiModelReasoningEffortSettings,
  controlsThinking: boolean,
): AiModelReasoningEffortSettings => {
  const { controlsThinking: _, ...rest } = value;
  return controlsThinking ? { ...rest, controlsThinking: true } : rest;
};
