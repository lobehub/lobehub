import type { AgentArtworkPromptInput } from '@lobechat/prompts';
import { buildAgentArtworkPrompt } from '@lobechat/prompts';

import { generateArtworkImage } from '@/services/artworkGeneration';
import { generationService } from '@/services/generation';
import type { StoreSetter } from '@/store/types';

import type { AgentStore } from '../../store';
import type { AgentArtworkGenerationState } from './initialState';

interface AgentArtworkGenerationJob {
  controller: AbortController;
  generationId?: string;
}

interface GenerateAgentArtworkInput extends AgentArtworkPromptInput {
  /** False for companion artwork that is previewed without replacing the avatar or cover. */
  persist?: boolean;
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

  generateAgentArtwork = async (input: GenerateAgentArtworkInput): Promise<string | undefined> => {
    if (this.#get().agentArtworkGenerationMap[input.id]?.status === 'generating') return;

    const job: AgentArtworkGenerationJob = { controller: new AbortController() };
    this.#generationJobs.set(input.id, job);
    this.#setGenerationState(input.id, { kind: input.kind, status: 'generating' });

    try {
      const url = await generateArtworkImage({
        buildPrompt: (references) => buildAgentArtworkPrompt({ ...input, ...references }),
        composition: input.composition,
        kind: input.kind,
        onGenerationCreated: (generationId) => {
          job.generationId = generationId;
        },
        referenceImageUrl: input.referenceImageUrl,
        signal: job.controller.signal,
        styleReferenceImageUrls: input.styleReferenceImageUrls,
        topicTitle: input.kind === 'avatar' ? 'Agent avatar' : 'Agent background',
      });

      if (input.persist !== false) {
        await this.#get().updateAgentMetaById(
          input.id,
          input.kind === 'avatar' ? { avatar: url } : { backgroundColor: url },
        );
      }
      this.#setGenerationState(input.id, undefined);
      return url;
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
