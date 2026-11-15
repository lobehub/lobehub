import type { AiModelType, TTSVoice } from 'model-bank';

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

/** Options of the default-voice select: `Kore · Firm`, or the bare name without a description. */
export const buildTTSVoiceOptions = (voices: TTSVoice[] | undefined) =>
  voices?.map((voice) => ({
    label: voice.description ? `${voice.displayName} · ${voice.description}` : voice.displayName,
    value: voice.id,
  })) ?? [];
