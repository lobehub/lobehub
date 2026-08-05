import { generationService } from '@/services/generation';
import { generationTopicService } from '@/services/generationTopic';
import { imageService } from '@/services/image';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/selectors';
import { AsyncTaskStatus } from '@/types/asyncTask';

import type { AgentArtworkKind } from './utils';
import { selectAgentArtworkModel } from './utils';

const POLL_INTERVAL = 1500;
const POLL_LIMIT = 120;

const wait = (duration: number) => new Promise((resolve) => setTimeout(resolve, duration));

const getGeneratedImageUrl = async (generationId: string, asyncTaskId: string) => {
  for (let count = 0; count < POLL_LIMIT; count += 1) {
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

    await wait(POLL_INTERVAL);
  }

  throw new Error('Image generation timed out');
};

export const useGenerateAgentArtwork = () => {
  const enabledImageModelList = useAiInfraStore(aiProviderSelectors.enabledImageModelList);

  const generate = async (kind: AgentArtworkKind, prompt: string) => {
    const selection = selectAgentArtworkModel(enabledImageModelList);

    if (!selection) throw new Error('No image generation model is available');

    const { model, provider } = selection;

    const generationTopicId = await generationTopicService.createTopic(
      'image',
      'private',
      kind === 'avatar' ? 'Agent avatar' : 'Agent background',
    );
    const aspectRatio = kind === 'avatar' ? '1:1' : '16:9';
    const params = {
      ...(model.parameters && 'aspectRatio' in model.parameters ? { aspectRatio } : {}),
      prompt,
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

    return getGeneratedImageUrl(generationId, asyncTaskId);
  };

  return { canGenerate: enabledImageModelList.length > 0, generate };
};
