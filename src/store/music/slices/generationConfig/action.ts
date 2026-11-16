import { type AIText2MusicModelCard } from 'model-bank/aiModel';
import {
  extractMusicDefaultValues,
  type MusicModelParamsSchema,
  type RuntimeMusicGenParams,
  type RuntimeMusicGenParamsKeys,
} from 'model-bank/standardParameters';

import { aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { useGlobalStore } from '@/store/global';
import { type StoreSetter } from '@/store/types';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import type { MusicStore } from '../../store';

export function getMusicModelAndDefaults(model: string, provider: string) {
  const enabledMusicModelList = aiProviderSelectors.enabledMusicModelList(getAiInfraStoreState());

  const providerItem = enabledMusicModelList.find((providerItem) => providerItem.id === provider);
  if (!providerItem) {
    throw new Error(
      `Provider "${provider}" not found in enabled music provider list. Available providers: ${enabledMusicModelList.map((p) => p.id).join(', ')}`,
    );
  }

  const activeModel = providerItem.children.find(
    (modelItem) => modelItem.id === model,
  ) as unknown as AIText2MusicModelCard;
  if (!activeModel) {
    throw new Error(
      `Model "${model}" not found in provider "${provider}". Available models: ${providerItem.children.map((m) => m.id).join(', ')}`,
    );
  }

  // A custom music model without a declared schema still takes a prompt
  const parametersSchema = (activeModel.parameters ?? {
    prompt: { default: '' },
  }) as MusicModelParamsSchema;
  const defaultValues = extractMusicDefaultValues(parametersSchema);

  return { activeModel, defaultValues, parametersSchema };
}

/** Text the user typed survives a model switch when the next model accepts it */
const CARRIED_TEXT_KEYS: RuntimeMusicGenParamsKeys[] = [
  'prompt',
  'lyrics',
  'title',
  'style',
  'negativeStyle',
  'referenceAudioUrl',
];

/**
 * Start from the next model's defaults and keep the text the user already typed for every
 * param the next model also declares.
 */
export const carryMusicParams = (
  previous: RuntimeMusicGenParams,
  nextDefaults: RuntimeMusicGenParams,
  nextSchema: MusicModelParamsSchema,
): RuntimeMusicGenParams => {
  const result: Record<string, unknown> = { ...nextDefaults };
  for (const key of CARRIED_TEXT_KEYS) {
    if (key in nextSchema && previous[key] !== undefined) result[key] = previous[key];
  }
  return result as unknown as RuntimeMusicGenParams;
};

type Setter = StoreSetter<MusicStore>;

export const createGenerationConfigSlice = (set: Setter, get: () => MusicStore, _api?: unknown) =>
  new GenerationConfigActionImpl(set, get, _api);

export class GenerationConfigActionImpl {
  readonly #get: () => MusicStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => MusicStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#set = set;
  }

  /** Open the page on `model`, or keep the placeholder when no music model is enabled */
  initializeMusicConfig = (model?: string, provider?: string): void => {
    if (model && provider) {
      try {
        const { defaultValues, parametersSchema } = getMusicModelAndDefaults(model, provider);

        this.#set(
          { isInit: true, model, parameters: defaultValues, parametersSchema, provider },
          false,
          `initializeMusicConfig/${model}/${provider}`,
        );
        return;
      } catch {
        // fall through to the placeholder below
      }
    }

    this.#set({ isInit: true }, false, 'initializeMusicConfig/default');
  };

  setModelAndProviderOnSelect = (model: string, provider: string): void => {
    const { parameters: previousParameters } = this.#get();
    const { defaultValues, parametersSchema } = getMusicModelAndDefaults(model, provider);
    const parameters = carryMusicParams(previousParameters, defaultValues, parametersSchema);

    this.#set(
      { model, parameters, parametersSchema, provider },
      false,
      `setModelAndProviderOnSelect/${model}/${provider}`,
    );

    const isLogin = authSelectors.isLogin(useUserStore.getState());
    if (isLogin) {
      useGlobalStore.getState().updateSystemStatus({
        lastSelectedMusicModel: model,
        lastSelectedMusicProvider: provider,
      });
    }
  };

  /** Load a previous generation's model and settings into the draft */
  reuseMusicSettings = (model: string, provider: string, config?: RuntimeMusicGenParams): void => {
    try {
      this.setModelAndProviderOnSelect(model, provider);
    } catch {
      // The model is no longer enabled: keep the current model and only reuse the text
    }
    if (!config) return;

    const { parameters, parametersSchema } = this.#get();
    const merged: Record<string, unknown> = { ...parameters };
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined && key in parametersSchema) merged[key] = value;
    }

    this.#set(
      { parameters: merged as unknown as RuntimeMusicGenParams },
      false,
      `reuseMusicSettings/${model}/${provider}`,
    );
  };

  setParamOnInput = <K extends RuntimeMusicGenParamsKeys>(
    paramName: K,
    value: RuntimeMusicGenParams[K],
  ): void => {
    this.#set(
      (state) => ({ parameters: { ...state.parameters, [paramName]: value } }),
      false,
      `setParamOnInput/${paramName}`,
    );
  };

  setUploadingReferenceAudio = (fileName?: string): void => {
    this.#set({ uploadingReferenceAudio: fileName }, false, 'setUploadingReferenceAudio');
  };
}

export type GenerationConfigAction = Pick<
  GenerationConfigActionImpl,
  keyof GenerationConfigActionImpl
>;
