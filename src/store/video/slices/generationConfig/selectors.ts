import { type RuntimeVideoGenParamsKeys } from 'model-bank';
import { supportsConversationalVideoEditReferences } from 'model-bank/standardParameters';

import type { VideoStore } from '../../store';
import {
  getImageInputSlots,
  supportsImageInputMode,
  type VideoImageInputMode,
  type VideoImageInputs,
  type VideoImageInputSlots,
} from './imageInputMode';
import { type VideoGenerationConfigState } from './initialState';

const model = (s: VideoGenerationConfigState) => s.model;
const provider = (s: VideoGenerationConfigState) => s.provider;
const uploadingImagePreviews = (s: VideoGenerationConfigState) => s.uploadingImagePreviews;

const parameters = (s: VideoGenerationConfigState) => s.parameters;
const parametersSchema = (s: VideoGenerationConfigState) => s.parametersSchema;
const isSupportedParam = (paramName: RuntimeVideoGenParamsKeys) => {
  return (s: VideoGenerationConfigState) => {
    const _parametersSchema = parametersSchema(s);
    return Boolean(paramName in _parametersSchema);
  };
};

/** Whether the current model accepts both start frames and references, i.e. shows the mode toggle */
const hasImageInputMode = (s: VideoGenerationConfigState) =>
  supportsImageInputMode(s.parametersSchema);
const imageInputMode = (s: VideoGenerationConfigState) => s.imageInputMode;
const aspectRatioFollowsFrames = (s: VideoGenerationConfigState) =>
  hasImageInputMode(s) &&
  !s.parametersSchema.aspectRatio?.supportsWithFrames &&
  s.imageInputMode === 'frames' &&
  Boolean(s.parameters.imageUrl || s.parameters.endImageUrl);
/** Whether an upload slot is shown for the current model and active image input mode */
const isImageInputSlotEnabled = (slot: keyof VideoImageInputSlots) => (s: VideoStore) => {
  if (s.editingGenerationId) {
    return slot === 'imageUrls' && supportsConversationalVideoEditReferences(s.model);
  }

  return getImageInputSlots(s.parametersSchema, s.imageInputMode)[slot];
};

/** Image inputs of `mode`: the submitted parameters when it is active, otherwise its stash */
const imageInputsOfMode =
  (mode: VideoImageInputMode) =>
  (s: VideoGenerationConfigState): VideoImageInputs =>
    mode === s.imageInputMode ? s.parameters : (s.stashedImageInputs[mode] ?? {});

export const videoGenerationConfigSelectors = {
  aspectRatioFollowsFrames,
  hasImageInputMode,
  imageInputMode,
  imageInputsOfMode,
  isImageInputSlotEnabled,
  isSupportedParam,
  model,
  parameters,
  parametersSchema,
  provider,
  uploadingImagePreviews,
};
