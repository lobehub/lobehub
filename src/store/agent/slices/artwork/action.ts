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

const wait = (duration: number) => new Promise((resolve) => setTimeout(resolve, duration));

type Setter = StoreSetter<AgentStore>;

export const createAgentArtworkSlice = (set: Setter, get: () => AgentStore, _api?: unknown) =>
  new AgentArtworkActionImpl(set, get, _api);

export class AgentArtworkActionImpl {
  readonly #get: () => AgentStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => AgentStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  #getGeneratedImageUrl = async (generationId: string, asyncTaskId: string) => {
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

    this.#setGenerationState(input.id, { kind: input.kind, status: 'generating' });

    try {
      const enabledImageModelList =
        aiProviderSelectors.enabledImageModelList(getAiInfraStoreState());
      const selection = selectAgentArtworkModel(enabledImageModelList);
      if (!selection) throw new Error('No image generation model is available');

      const { model, provider } = selection;
      const generationTopicId = await generationTopicService.createTopic(
        'image',
        'private',
        input.kind === 'avatar' ? 'Agent avatar' : 'Agent background',
      );
      const aspectRatio = input.kind === 'avatar' ? '1:1' : '16:9';
      const params = {
        ...(model.parameters && 'aspectRatio' in model.parameters ? { aspectRatio } : {}),
        prompt: buildAgentArtworkPrompt(input),
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

      const url = await this.#getGeneratedImageUrl(generationId, asyncTaskId);
      await this.#get().updateAgentMetaById(
        input.id,
        input.kind === 'avatar' ? { avatar: url } : { backgroundColor: url },
      );
      this.#setGenerationState(input.id, undefined);
    } catch (error) {
      console.error('Failed to generate agent artwork:', error);
      this.#setGenerationState(input.id, {
        error: error instanceof Error ? error.message : 'Image generation failed',
        kind: input.kind,
        status: 'error',
      });
      throw error;
    }
  };
}

export type AgentArtworkSliceAction = Pick<AgentArtworkActionImpl, keyof AgentArtworkActionImpl>;
