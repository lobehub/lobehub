import type { RuntimeVideoGenParams, VideoModelParamsSchema } from 'model-bank';

/**
 * How a model that accepts both a start frame (`imageUrl`) and reference images (`imageUrls`)
 * uses the uploaded images:
 * - `frames`: start frame + optional end frame; the video opens on the start frame
 * - `reference`: reference images only; subjects/style carry over, composition follows the prompt
 *
 * Providers such as MiniMax H3 merge every image into one reference pool as soon as `imageUrls`
 * is non-empty, so a single upload could otherwise never be used as a reference.
 */
export type VideoImageInputMode = 'frames' | 'reference';

export type VideoImageInputs = Pick<
  RuntimeVideoGenParams,
  'endImageUrl' | 'imageUrl' | 'imageUrls'
>;

export interface VideoImageInputSlots {
  endImageUrl: boolean;
  imageUrl: boolean;
  imageUrls: boolean;
}

export const supportsImageInputMode = (schema?: VideoModelParamsSchema) =>
  !!schema && 'imageUrl' in schema && 'imageUrls' in schema;

/**
 * Upload slots shown for the schema. Models with both start frame and reference support expose
 * only the slots of the active mode; other models keep every slot their schema declares.
 */
export const getImageInputSlots = (
  schema: VideoModelParamsSchema | undefined,
  mode: VideoImageInputMode,
): VideoImageInputSlots => {
  const slots = {
    endImageUrl: !!schema && 'endImageUrl' in schema,
    imageUrl: !!schema && 'imageUrl' in schema,
    imageUrls: !!schema && 'imageUrls' in schema,
  };
  if (!supportsImageInputMode(schema)) return slots;

  return mode === 'reference'
    ? { endImageUrl: false, imageUrl: false, imageUrls: true }
    : { endImageUrl: slots.endImageUrl, imageUrl: true, imageUrls: false };
};

export const pickImageInputs = (
  parameters: RuntimeVideoGenParams,
  mode: VideoImageInputMode,
): VideoImageInputs =>
  mode === 'reference'
    ? { imageUrls: parameters.imageUrls ?? [] }
    : { endImageUrl: parameters.endImageUrl ?? null, imageUrl: parameters.imageUrl ?? null };

/**
 * Return the parameters with only the given mode's images, taken from `inputs`.
 */
export const applyImageInputs = (
  parameters: RuntimeVideoGenParams,
  mode: VideoImageInputMode,
  inputs: VideoImageInputs = {},
): RuntimeVideoGenParams =>
  mode === 'reference'
    ? { ...parameters, endImageUrl: null, imageUrl: null, imageUrls: inputs.imageUrls ?? [] }
    : {
        ...parameters,
        endImageUrl: inputs.endImageUrl ?? null,
        imageUrl: inputs.imageUrl ?? null,
        imageUrls: [],
      };

/**
 * Derive the mode from parameters loaded from elsewhere (model switch, reused settings) and keep
 * them consistent with it. Reference images win, mirroring the runtime: when `imageUrls` is set,
 * start and end frames are folded into the reference pool in the order providers receive them.
 */
export const normalizeImageInputMode = (
  parameters: RuntimeVideoGenParams,
  schema: VideoModelParamsSchema,
  fallbackMode: VideoImageInputMode,
): { imageInputMode: VideoImageInputMode; parameters: RuntimeVideoGenParams } => {
  if (!supportsImageInputMode(schema)) return { imageInputMode: 'frames', parameters };

  const { endImageUrl, imageUrl, imageUrls } = parameters;
  const imageInputMode: VideoImageInputMode = imageUrls?.length
    ? 'reference'
    : imageUrl || endImageUrl
      ? 'frames'
      : fallbackMode;

  if (imageInputMode === 'frames') {
    return { imageInputMode, parameters: applyImageInputs(parameters, 'frames', parameters) };
  }

  const pool = [imageUrl, ...(imageUrls ?? []), endImageUrl].filter((url): url is string => !!url);
  const maxCount = schema.imageUrls?.maxCount;

  return {
    imageInputMode,
    parameters: applyImageInputs(parameters, 'reference', {
      imageUrls: typeof maxCount === 'number' ? pool.slice(0, maxCount) : pool,
    }),
  };
};
