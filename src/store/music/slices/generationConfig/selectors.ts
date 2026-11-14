import { type MusicModelParamsKeys } from 'model-bank/standardParameters';

import { type MusicGenerationConfigState } from './initialState';

const model = (s: MusicGenerationConfigState) => s.model;
const provider = (s: MusicGenerationConfigState) => s.provider;
const parameters = (s: MusicGenerationConfigState) => s.parameters;
const parametersSchema = (s: MusicGenerationConfigState) => s.parametersSchema;
const uploadingReferenceAudio = (s: MusicGenerationConfigState) => s.uploadingReferenceAudio;

/** Whether the selected model's schema declares `paramName`; undeclared params stay hidden */
const isSupportedParam = (paramName: MusicModelParamsKeys) => (s: MusicGenerationConfigState) =>
  Boolean(s.parametersSchema && paramName in s.parametersSchema);

const hasText = (value?: string | null) => !!value && value.trim().length > 0;

/**
 * Whether the draft has enough input to submit: the selected model's required params are filled
 * and the draft carries at least one piece of song input.
 */
const canSubmit = (s: MusicGenerationConfigState) => {
  const { model, parameters: params, parametersSchema: schema } = s;

  if (!model) return false;
  if (schema.referenceAudioUrl?.required && !hasText(params.referenceAudioUrl)) return false;

  // Lyrics are not sent for an instrumental track, so they cannot count as input
  const hasLyrics = !params.instrumental && hasText(params.lyrics);

  return (
    hasText(params.prompt) ||
    hasLyrics ||
    hasText(params.style) ||
    hasText(params.referenceAudioUrl)
  );
};

export const musicGenerationConfigSelectors = {
  canSubmit,
  isSupportedParam,
  model,
  parameters,
  parametersSchema,
  provider,
  uploadingReferenceAudio,
};
