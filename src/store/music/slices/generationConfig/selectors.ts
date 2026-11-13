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

/** Suno cards (`suno-v6`, …) whichever provider serves them */
const SUNO_MODEL_PATTERN = /^suno-/i;
/** MiniMax Music text-to-song (`music-2.6`, `music-3.0`) and cover (`music-cover`) cards */
const MINIMAX_MUSIC_MODEL_PATTERN = /^music-/i;
const MINIMAX_COVER_MODEL_PATTERN = /^music-cover/i;

/**
 * Whether the draft has enough input to submit. The gate mirrors the input rules the provider
 * runtimes enforce (`packages/model-runtime/src/providers/{suno,minimax}/createMusic.ts`), so the
 * form never queues a batch that the provider would refuse.
 */
const canSubmit = (s: MusicGenerationConfigState) => {
  const { model, parameters: params, parametersSchema: schema } = s;

  if (schema.referenceAudioUrl?.required && !params.referenceAudioUrl) return false;

  const hasReferenceAudio = hasText(params.referenceAudioUrl);
  // Lyrics are not sent for an instrumental track, so they cannot count as input
  const hasLyrics = !params.instrumental && hasText(params.lyrics);

  if (SUNO_MODEL_PATTERN.test(model)) {
    // Title, negative style and duration exist only in Suno's custom mode
    const customMode =
      hasText(params.title) || hasText(params.negativeStyle) || typeof params.duration === 'number';

    if (customMode) {
      return (
        !hasReferenceAudio && (hasLyrics || hasText(params.style) || hasText(params.negativeStyle))
      );
    }

    // A prompt is only the core idea: Suno also needs a style, lyrics or reference audio
    return hasLyrics || hasText(params.style) || hasReferenceAudio;
  }

  if (MINIMAX_COVER_MODEL_PATTERN.test(model)) {
    return (
      hasReferenceAudio && hasText(params.prompt) && !params.instrumental && !params.autoLyrics
    );
  }

  if (MINIMAX_MUSIC_MODEL_PATTERN.test(model)) {
    if (hasReferenceAudio) return false;
    if (params.instrumental) return hasText(params.prompt);

    // A vocal track needs lyrics, or a prompt for the auto-lyrics writer
    return hasLyrics || (!!params.autoLyrics && hasText(params.prompt));
  }

  return hasText(params.prompt) || hasLyrics || hasText(params.style) || hasReferenceAudio;
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
