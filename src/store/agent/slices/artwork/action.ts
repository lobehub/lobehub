import type { AgentArtworkPromptInput } from '@lobechat/prompts';
import { buildAgentArtworkPrompt } from '@lobechat/prompts';

import { generationService } from '@/services/generation';
import { generationTopicService } from '@/services/generationTopic';
import { imageService } from '@/services/image';
import { getAiInfraStoreState } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/selectors';
import type { StoreSetter } from '@/store/types';
import { AsyncTaskStatus } from '@/types/asyncTask';

import type { AgentStore } from '../../store';
import type { AgentArtworkGenerationState } from './initialState';
import { selectAgentArtworkModel } from './utils';

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

interface AgentArtworkGenerationJob {
  controller: AbortController;
  generationId?: string;
}

type Setter = StoreSetter<AgentStore>;

export const createAgentArtworkSlice = (set: Setter, get: () => AgentStore, _api?: unknown) =>
  new AgentArtworkActionImpl(set, get, _api);

export class AgentArtworkActionImpl {
  readonly #generationJobs = new Map<string, AgentArtworkGenerationJob>();
  readonly #get: () => AgentStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => AgentStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  #getGeneratedImageUrl = async (
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

  cancelAgentArtworkGeneration = async (agentId: string): Promise<void> => {
    const job = this.#generationJobs.get(agentId);
    if (!job) {
      this.#setGenerationState(agentId, undefined);
      return;
    }

    job.controller.abort(new DOMException('Agent artwork generation cancelled', 'AbortError'));
    this.#setGenerationState(agentId, undefined);

    if (job.generationId) await generationService.deleteGeneration(job.generationId);
  };

  #setGenerationState = (agentId: string, value: AgentArtworkGenerationState | undefined) => {
    this.#set(
      (state) => {
        const agentArtworkGenerationMap = { ...state.agentArtworkGenerationMap };
        if (value) agentArtworkGenerationMap[agentId] = value;
        else delete agentArtworkGenerationMap[agentId];

        return { agentArtworkGenerationMap };
      },
      false,
      'setAgentArtworkGenerationState',
    );
  };

  generateAgentArtwork = async (input: AgentArtworkPromptInput): Promise<void> => {
    if (this.#get().agentArtworkGenerationMap[input.id]?.status === 'generating') return;

    const job: AgentArtworkGenerationJob = { controller: new AbortController() };
    this.#generationJobs.set(input.id, job);
    this.#setGenerationState(input.id, { kind: input.kind, status: 'generating' });

    try {
      const enabledImageModelList =
        aiProviderSelectors.enabledImageModelList(getAiInfraStoreState());
      const selection = selectAgentArtworkModel(enabledImageModelList);
      if (!selection) throw new Error('No image generation model is available');

      const { model, provider } = selection;
      const supportsImageInput = !!model.parameters && 'imageUrls' in model.parameters;
      const imageInputLimit = supportsImageInput
        ? (model.parameters?.imageUrls?.maxCount ?? Number.POSITIVE_INFINITY)
        : 0;
      // Style references win over the counterpart-artwork reference; the prompt
      // builder applies the same precedence so wording matches attachments.
      const styleReferenceImageUrls = (input.styleReferenceImageUrls ?? [])
        .map((url) => url.trim())
        .filter(Boolean)
        .slice(0, imageInputLimit);
      const referenceImageUrl =
        styleReferenceImageUrls.length > 0 ? undefined : input.referenceImageUrl?.trim();
      const supportsReferenceImage = !!referenceImageUrl && supportsImageInput;
      const imageUrls =
        styleReferenceImageUrls.length > 0
          ? styleReferenceImageUrls
          : supportsReferenceImage
            ? [referenceImageUrl]
            : undefined;
      const supportedSizes =
        model.parameters && 'size' in model.parameters ? model.parameters.size?.enum : undefined;
      const preferredSizes =
        input.kind === 'avatar'
          ? ['1024x1024', '2048x2048']
          : ['2048x1152', '1536x1024', '3840x2160'];
      const size = preferredSizes.find((item) => supportedSizes?.includes(item));
      const generationTopicId = await generationTopicService.createTopic(
        'image',
        'private',
        input.kind === 'avatar' ? 'Agent avatar' : 'Agent background',
      );
      const aspectRatio = input.kind === 'avatar' ? '1:1' : '16:9';
      const params = {
        ...(model.parameters && 'aspectRatio' in model.parameters ? { aspectRatio } : {}),
        ...(imageUrls ? { imageUrls } : {}),
        ...(size ? { size } : {}),
        prompt: buildAgentArtworkPrompt({
          ...input,
          referenceImageUrl: supportsReferenceImage ? referenceImageUrl : undefined,
          styleReferenceImageUrls,
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

      job.generationId = generationId;
      if (job.controller.signal.aborted) {
        await generationService.deleteGeneration(generationId);
        job.controller.signal.throwIfAborted();
      }
      const url = await this.#getGeneratedImageUrl(
        generationId,
        asyncTaskId,
        job.controller.signal,
      );
      job.controller.signal.throwIfAborted();
      await this.#get().updateAgentMetaById(
        input.id,
        input.kind === 'avatar' ? { avatar: url } : { backgroundColor: url },
      );
      this.#setGenerationState(input.id, undefined);
    } catch (error) {
      if (job.controller.signal.aborted) return;

      console.error('Failed to generate agent artwork:', error);
      this.#setGenerationState(input.id, {
        error: error instanceof Error ? error.message : 'Image generation failed',
        kind: input.kind,
        status: 'error',
      });
      throw error;
    } finally {
      if (this.#generationJobs.get(input.id) === job) this.#generationJobs.delete(input.id);
    }
  };
}

export type AgentArtworkSliceAction = Pick<AgentArtworkActionImpl, keyof AgentArtworkActionImpl>;
