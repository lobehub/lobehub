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

/**
 * Whether the draft has enough input to submit: the server needs at least one of prompt, lyrics,
 * style or reference audio, and a model that requires reference audio needs it set.
 */
const canSubmit = (s: MusicGenerationConfigState) => {
  const { parameters: params, parametersSchema: schema } = s;
  const hasText = (value?: string | null) => !!value && value.trim().length > 0;

  if (schema.referenceAudioUrl?.required && !params.referenceAudioUrl) return false;

  return (
    hasText(params.prompt) ||
    // Lyrics are not sent for an instrumental track, so they cannot stand in for the prompt
    (!params.instrumental && hasText(params.lyrics)) ||
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
