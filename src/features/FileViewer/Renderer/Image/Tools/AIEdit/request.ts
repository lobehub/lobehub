import {
  DEFAULT_AI_IMAGE_MODEL,
  DEFAULT_AI_IMAGE_PROVIDER,
} from '@/store/image/slices/generationConfig/initialState';
import type { EnabledProviderWithModels } from '@/types/aiProvider';

export type AIEditOperation = 'erase' | 'removeBackground';

/** Paint color that marks the erase region on the guide image sent to the model. */
export const ERASE_MARK_COLOR = '#ff00ff';

export const AI_EDIT_PROMPTS: Record<AIEditOperation, string> = {
  erase:
    'The areas painted in solid magenta (#FF00FF) mark content to erase. Remove everything under the magenta paint and fill those areas so they blend seamlessly with the surrounding image, as if the erased content was never there. Keep every other part of the image exactly as it is, keep the same framing and aspect ratio, and make sure no magenta remains in the result.',
  removeBackground:
    'Remove the background of this image. Keep the main subject exactly as it is — same position, size, colors and details — and place it on a single flat, uniform chroma-key green (#00FF00) backdrop with no gradient, shadow, texture or reflection. Keep the same framing and aspect ratio and do not add anything else.',
};

export interface AIEditModel {
  /** Largest reference image the model accepts, in bytes, when it declares one. */
  maxFileSize?: number;
  model: string;
  provider: string;
  /** Which reference-image parameter the model reads. */
  referenceParam: 'imageUrl' | 'imageUrls';
}

const referenceParamOf = (
  parameters: Record<string, unknown> | undefined,
): AIEditModel['referenceParam'] | undefined => {
  if (!parameters) return;
  if ('imageUrls' in parameters) return 'imageUrls';
  if ('imageUrl' in parameters) return 'imageUrl';
};

const findEditable = (
  providers: EnabledProviderWithModels[],
  provider: string | undefined,
  model: string | undefined,
): AIEditModel | undefined => {
  for (const item of providers) {
    if (provider && item.id !== provider) continue;
    for (const card of item.children) {
      if (model && card.id !== model) continue;
      const parameters = card.parameters as Record<string, unknown> | undefined;
      const referenceParam = referenceParamOf(parameters);
      if (!referenceParam) continue;
      const maxFileSize = (parameters?.[referenceParam] as { maxFileSize?: unknown } | undefined)
        ?.maxFileSize;
      return {
        ...(typeof maxFileSize === 'number' ? { maxFileSize } : {}),
        model: card.id,
        provider: item.id,
        referenceParam,
      };
    }
  }
};

/**
 * Pick an enabled image model that accepts a reference image, in the same order
 * the image page initializes: the user's last pick, then the default model
 * (default provider first), then any model that can edit.
 */
export const resolveAIEditModel = (
  providers: EnabledProviderWithModels[],
  lastSelected?: { model?: string; provider?: string },
): AIEditModel | undefined => {
  if (lastSelected?.model && lastSelected.provider) {
    const picked = findEditable(providers, lastSelected.provider, lastSelected.model);
    if (picked) return picked;
  }

  return (
    findEditable(providers, DEFAULT_AI_IMAGE_PROVIDER, DEFAULT_AI_IMAGE_MODEL) ??
    findEditable(providers, undefined, DEFAULT_AI_IMAGE_MODEL) ??
    findEditable(providers, undefined, undefined)
  );
};

/** Payload for `image.createImage`: one image, edited from a single reference. */
export const buildAIEditRequest = ({
  generationTopicId,
  imageUrl,
  model,
  operation,
}: {
  generationTopicId: string;
  imageUrl: string;
  model: AIEditModel;
  operation: AIEditOperation;
}) => ({
  generationTopicId,
  imageNum: 1,
  model: model.model,
  params: {
    prompt: AI_EDIT_PROMPTS[operation],
    ...(model.referenceParam === 'imageUrls' ? { imageUrls: [imageUrl] } : { imageUrl }),
  },
  provider: model.provider,
});
