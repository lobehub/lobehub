import type { AgentArtworkComposition, AgentArtworkKind } from '@lobechat/prompts';

import { generationService } from '@/services/generation';
import { generationTopicService } from '@/services/generationTopic';
import { imageService } from '@/services/image';
import { getAiInfraStoreState } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/selectors';
import { AsyncTaskStatus } from '@/types/asyncTask';

import { selectAgentArtworkModel } from './selectModel';

const POLL_INTERVAL = 1500;
const POLL_LIMIT = 120;

const wait = (duration: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, duration);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });

const pollGeneratedImageUrl = async (
  generationId: string,
  asyncTaskId: string,
  signal: AbortSignal,
) => {
  for (let count = 0; count < POLL_LIMIT; count += 1) {
    signal.throwIfAborted();
    const result = await generationService.getGenerationStatus(generationId, asyncTaskId);

    if (result.status === AsyncTaskStatus.Success) {
      const asset = result.generation?.asset;
      const url = asset?.url || asset?.thumbnailUrl || asset?.originalUrl;
      if (!url) throw new Error('Generated image has no usable URL');

      return url;
    }

    if (result.status === AsyncTaskStatus.Error) {
      const body = result.error?.body;
      const detail = typeof body === 'string' ? body : body?.detail;
      throw new Error(detail || 'Image generation failed');
    }

    await wait(POLL_INTERVAL, signal);
  }

  throw new Error('Image generation timed out');
};

/**
 * References that actually survived the chosen model's capabilities — the
 * prompt has to describe exactly what got attached, or the wording promises
 * the model an image it never received.
 */
export interface AttachedArtworkReferences {
  referenceImageUrl?: string;
  styleReferenceImageUrls: string[];
}

export interface GenerateArtworkImageOptions {
  buildPrompt: (references: AttachedArtworkReferences) => string;
  composition?: AgentArtworkComposition;
  kind: AgentArtworkKind;
  /**
   * Fires as soon as the remote generation exists, so a caller that owns the
   * cancel affordance can delete it after the fact.
   */
  onGenerationCreated?: (generationId: string) => void;
  referenceImageUrl?: string | null;
  signal: AbortSignal;
  styleReferenceImageUrls?: string[] | null;
  /** Title of the private generation topic the image is filed under. */
  topicTitle: string;
}

/**
 * Runs one artwork generation end to end — model pick, reference budgeting,
 * topic creation, submission, polling — and resolves with the image url.
 *
 * Shared by every "one-click artwork" surface (Agent avatars and covers,
 * workspace avatars), so it deliberately knows nothing about where the
 * resulting url is saved.
 */
export const generateArtworkImage = async ({
  buildPrompt,
  composition,
  kind,
  onGenerationCreated,
  referenceImageUrl,
  signal,
  styleReferenceImageUrls,
  topicTitle,
}: GenerateArtworkImageOptions): Promise<string> => {
  const enabledImageModelList = aiProviderSelectors.enabledImageModelList(getAiInfraStoreState());
  const selection = selectAgentArtworkModel(enabledImageModelList);
  if (!selection) throw new Error('No image generation model is available');

  const { model, provider } = selection;
  const supportsImageInput = !!model.parameters && 'imageUrls' in model.parameters;
  const imageInputLimit = supportsImageInput
    ? (model.parameters?.imageUrls?.maxCount ?? Number.POSITIVE_INFINITY)
    : 0;
  // Style references win over the counterpart-artwork reference; the prompt
  // builders apply the same precedence so wording matches attachments.
  const attachedStyleReferences = (styleReferenceImageUrls ?? [])
    .map((url) => url.trim())
    .filter(Boolean)
    .slice(0, imageInputLimit);
  const counterpartReferenceUrl =
    attachedStyleReferences.length > 0 ? undefined : referenceImageUrl?.trim();
  const supportsReferenceImage = !!counterpartReferenceUrl && supportsImageInput;
  const imageUrls =
    attachedStyleReferences.length > 0
      ? attachedStyleReferences
      : supportsReferenceImage
        ? [counterpartReferenceUrl]
        : undefined;
  const supportedSizes =
    model.parameters && 'size' in model.parameters ? model.parameters.size?.enum : undefined;
  const preferredSizes =
    kind === 'background'
      ? ['2048x1152', '1536x1024', '3840x2160']
      : composition === 'fullBody'
        ? ['1024x1536', '2048x3072', '1440x2560', '2160x3840']
        : ['1024x1024', '2048x2048'];
  const size = preferredSizes.find((item) => supportedSizes?.includes(item));
  const generationTopicId = await generationTopicService.createTopic(
    'image',
    'private',
    topicTitle,
  );
  const aspectRatio = kind === 'background' ? '16:9' : composition === 'fullBody' ? '3:4' : '1:1';
  const params = {
    ...(model.parameters && 'aspectRatio' in model.parameters ? { aspectRatio } : {}),
    ...(imageUrls ? { imageUrls } : {}),
    ...(size ? { size } : {}),
    prompt: buildPrompt({
      referenceImageUrl: supportsReferenceImage ? counterpartReferenceUrl : undefined,
      styleReferenceImageUrls: attachedStyleReferences,
    }),
  };
  const result = await imageService.createImage({
    generationTopicId,
    imageNum: 1,
    model: model.id,
    params,
    provider: provider.id,
  });
  const generation = result.data?.generations[0];
  const generationId = generation?.id;
  const asyncTaskId = generation?.asyncTaskId;

  if (!result.success || !generationId || !asyncTaskId) {
    throw new Error('Image generation could not be started');
  }

  onGenerationCreated?.(generationId);
  // Cancellation can land while `createImage` is still in flight, in which case
  // nothing else will ever clean up the generation we just created.
  if (signal.aborted) {
    await generationService.deleteGeneration(generationId);
    signal.throwIfAborted();
  }

  const url = await pollGeneratedImageUrl(generationId, asyncTaskId, signal);
  signal.throwIfAborted();

  return url;
};
