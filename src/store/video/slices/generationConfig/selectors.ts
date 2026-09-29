import { type RuntimeVideoGenParamsKeys } from 'model-bank';

import {
  getImageInputSlots,
  supportsImageInputMode,
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
/** Whether an upload slot is shown for the current model and active image input mode */
const isImageInputSlotEnabled =
  (slot: keyof VideoImageInputSlots) => (s: VideoGenerationConfigState) =>
    getImageInputSlots(s.parametersSchema, s.imageInputMode)[slot];

export const videoGenerationConfigSelectors = {
  hasImageInputMode,
  imageInputMode,
  isImageInputSlotEnabled,
  isSupportedParam,
  model,
  parameters,
  parametersSchema,
  provider,
  uploadingImagePreviews,
};
