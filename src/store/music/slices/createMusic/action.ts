import { ChatErrorType } from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { TRPCClientError } from '@trpc/client';
import { t } from 'i18next';
import { type RuntimeMusicGenParams } from 'model-bank';

import { handleLobeHubModelDeprecatedError } from '@/business/client/handleLobeHubModelDeprecatedError';
import { isGenerationPromptModerationError } from '@/business/client/isGenerationPromptModerationError';
import { musicService } from '@/services/music';
import { type StoreSetter } from '@/store/types';
import { AsyncTaskStatus } from '@/types/asyncTask';

import { type MusicStore } from '../../store';
import { generationBatchSelectors } from '../generationBatch/selectors';
import { musicGenerationConfigSelectors } from '../generationConfig/selectors';
import { generationTopicSelectors } from '../generationTopic';

type Setter = StoreSetter<MusicStore>;

/** Shown by `handleLobeHubModelDeprecatedError`; every other failure needs its own toast. */
const isModelDeprecatedError = (error: unknown) =>
  error instanceof TRPCClientError && error.message === ChatErrorType.LobeHubModelDeprecated;

/**
 * Send only the params the selected model declares: the server rejects undeclared params, and
 * empty optional text is dropped so it does not change how the provider reads the request. Lyrics
 * are dropped for instrumental tracks.
 */
export const buildMusicRequestParams = (
  parameters: RuntimeMusicGenParams,
  parametersSchema: Record<string, unknown>,
): RuntimeMusicGenParams => {
  const result: Record<string, unknown> = { prompt: parameters.prompt ?? '' };

  for (const [key, value] of Object.entries(parameters)) {
    if (key === 'prompt' || !(key in parametersSchema)) continue;
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    result[key] = value;
  }

  // An instrumental track has no vocals, so lyrics left in the draft must not reach the provider
  if (result.instrumental === true) delete result.lyrics;

  return result as unknown as RuntimeMusicGenParams;
};

/** First non-empty text of the draft, used to title a new topic */
const topicSeedText = (parameters: RuntimeMusicGenParams) =>
  [
    parameters.prompt,
    parameters.title,
    parameters.style,
    parameters.instrumental ? undefined : parameters.lyrics,
  ].find((text) => !!text && text.trim().length > 0) ?? '';

export const createCreateMusicSlice = (set: Setter, get: () => MusicStore, _api?: unknown) =>
  new CreateMusicActionImpl(set, get, _api);

export class CreateMusicActionImpl {
  readonly #get: () => MusicStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => MusicStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  createMusic = async (): Promise<void> => {
    const store = this.#get();
    const parameters = musicGenerationConfigSelectors.parameters(store);
    const parametersSchema = musicGenerationConfigSelectors.parametersSchema(store);
    const provider = musicGenerationConfigSelectors.provider(store);
    const model = musicGenerationConfigSelectors.model(store);

    if (!musicGenerationConfigSelectors.canSubmit(store)) {
      throw new TypeError('music draft is empty');
    }

    this.#set(
      { blockedPrompt: undefined, isCreating: true },
      false,
      'createMusic/startCreateMusic',
    );

    const activeGenerationTopicId = generationTopicSelectors.activeGenerationTopicId(store);
    const { createGenerationTopic, switchGenerationTopic, setTopicBatchLoaded } = store;

    let finalTopicId = activeGenerationTopicId;

    try {
      // 1. Create a generation topic when none is active
      if (!activeGenerationTopicId) {
        const newGenerationTopicId = await createGenerationTopic([topicSeedText(parameters)]);
        finalTopicId = newGenerationTopicId;

        // Seed an empty batch list so the new topic paints without a skeleton
        setTopicBatchLoaded(newGenerationTopicId);
        switchGenerationTopic(newGenerationTopicId);
        this.#set(
          { isCreatingWithNewTopic: true },
          false,
          'createMusic/startCreateMusicWithNewTopic',
        );
      }

      // 2. Submit; the server creates the batch and one pending generation per song
      await musicService.createMusic({
        generationTopicId: finalTopicId!,
        model,
        params: buildMusicRequestParams(parameters, parametersSchema) as any,
        provider,
      });

      // 3. Clear the prompt; lyrics, title and style stay for the next variation. The server
      // accepted the batch, so a later refresh failure must not invite a duplicate (charged) retry.
      this.#set(
        (state) => ({ parameters: { ...state.parameters, prompt: '' } }),
        false,
        'createMusic/clearPrompt',
      );
    } catch (error) {
      // A rejected prompt is shown on the prompt input, where the user fixes it.
      if (isGenerationPromptModerationError(error)) {
        this.#set({ blockedPrompt: parameters.prompt }, false, 'createMusic/promptBlocked');
      } else if (isModelDeprecatedError(error)) {
        handleLobeHubModelDeprecatedError(error);
      } else {
        // Anything else (invalid params, a failed topic or batch request) would otherwise only reach
        // the console and the generate button would look unresponsive.
        toast.error(
          t('generation.submitFailed', {
            message: error instanceof Error ? error.message : String(error),
            ns: 'music',
          }),
        );
      }
      throw error;
    } finally {
      this.#set(
        { isCreating: false, isCreatingWithNewTopic: false },
        false,
        'createMusic/endCreateMusic',
      );
    }

    // 4. Show the new batch. The generation already started, so a failed refresh only hides it
    // until the list reloads; tell the user instead of reporting a failed submission.
    try {
      await this.#get().refreshGenerationBatches();
    } catch (error) {
      console.error('[createMusic] failed to refresh batches after submitting', error);
      toast.info(t('generation.submittedRefreshFailed', { ns: 'music' }));
    }
  };

  dismissBlockedPrompt = (): void => {
    this.#set({ blockedPrompt: undefined }, false, 'dismissBlockedPrompt');
  };

  /**
   * Retry a batch: submit its model and settings again in the same topic, then remove the
   * batch's failed songs. Songs that already succeeded stay, since a provider can fail one song
   * of a batch and keep the other.
   */
  recreateMusic = async (generationBatchId: string): Promise<void> => {
    const store = this.#get();
    const activeGenerationTopicId = generationTopicSelectors.activeGenerationTopicId(store);
    if (!activeGenerationTopicId) {
      throw new Error('No active generation topic');
    }

    const batch = generationBatchSelectors.getGenerationBatchByBatchId(generationBatchId)(store);
    if (!batch) return;

    this.#set(
      (state) => ({ retryingBatchIds: [...state.retryingBatchIds, generationBatchId] }),
      false,
      'recreateMusic/start',
    );

    try {
      // 1. Submit the replacement first: the server can reject the stored config, and the
      // original batch (with its error) must survive that rejection.
      // The stored config holds every param the batch was submitted with, prompt included
      const config = { prompt: '', ...batch.config } as unknown as RuntimeMusicGenParams;
      await musicService.createMusic({
        generationTopicId: activeGenerationTopicId,
        model: batch.model,
        params: buildMusicRequestParams(
          config,
          config as unknown as Record<string, unknown>,
        ) as any,
        provider: batch.provider,
      });

      // 2. Drop the failed songs; the batch itself goes once it is empty. The replacement is
      // already queued, so a failed cleanup must not surface as a failed retry.
      const failedIds = batch.generations
        .filter((generation) => generation.task.status === AsyncTaskStatus.Error)
        .map((generation) => generation.id);
      for (const generationId of failedIds) {
        try {
          await this.#get().removeGeneration(generationId);
        } catch (error) {
          console.error('[recreateMusic] failed to remove a failed song', error);
        }
      }

      await this.#get().refreshGenerationBatches();
    } catch (error) {
      // Regenerating reuses the batch's prompt, not the input's, so there is no
      // input to annotate; fall back to a toast.
      if (isGenerationPromptModerationError(error)) {
        toast.error(t('generation.promptModeration.blocked', { ns: 'common' }));
      }
      handleLobeHubModelDeprecatedError(error);
      throw error;
    } finally {
      this.#set(
        (state) => ({
          retryingBatchIds: state.retryingBatchIds.filter((id) => id !== generationBatchId),
        }),
        false,
        'recreateMusic/end',
      );
    }
  };
}

export type CreateMusicAction = Pick<CreateMusicActionImpl, keyof CreateMusicActionImpl>;
