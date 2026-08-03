import { renderHook } from '@testing-library/react';
import { ModelProvider } from 'model-bank/modelProvider';
import { afterEach, describe, expect, it } from 'vitest';

import { useAiInfraStore } from '@/store/aiInfra';

import {
  getVoiceMessageActionState,
  supportsRawAudioMessage,
  useVoiceMessageCapability,
} from './useVoiceMessageCapability';

const initialStoreState = useAiInfraStore.getState();

const audioModel = (id: string, providerId: string) =>
  ({
    abilities: { audio: true },
    enabled: true,
    id,
    providerId,
    type: 'chat',
  }) as const;

describe('supportsRawAudioMessage', () => {
  it.each([
    [ModelProvider.Google, ModelProvider.Google],
    [ModelProvider.OpenAI, ModelProvider.OpenAI],
    [ModelProvider.VertexAI, ModelProvider.VertexAI],
  ])('enables a model on the supported %s runtime', (provider, runtimeProvider) => {
    expect(
      supportsRawAudioMessage({
        isCuratedModel: false,
        modelSupportsAudio: true,
        provider,
        runtimeProvider,
      }),
    ).toBe(true);
  });

  it.each([ModelProvider.AiHubMix, ModelProvider.LobeHub])(
    'enables curated audio models on the %s router',
    (provider) => {
      expect(
        supportsRawAudioMessage({
          isCuratedModel: true,
          modelSupportsAudio: true,
          provider,
          runtimeProvider: provider,
        }),
      ).toBe(true);
    },
  );

  it('fails closed for a router model that is not in the curated audio model list', () => {
    expect(
      supportsRawAudioMessage({
        isCuratedModel: false,
        modelSupportsAudio: true,
        provider: ModelProvider.AiHubMix,
        runtimeProvider: ModelProvider.AiHubMix,
      }),
    ).toBe(false);
  });

  it('fails closed for an unsupported runtime even when the model claims audio support', () => {
    expect(
      supportsRawAudioMessage({
        isCuratedModel: false,
        modelSupportsAudio: true,
        provider: ModelProvider.Anthropic,
        runtimeProvider: ModelProvider.Anthropic,
      }),
    ).toBe(false);
  });

  it('requires the selected model to declare audio support', () => {
    expect(
      supportsRawAudioMessage({
        isCuratedModel: true,
        modelSupportsAudio: false,
        provider: ModelProvider.Google,
        runtimeProvider: ModelProvider.Google,
      }),
    ).toBe(false);
  });
});

describe('useVoiceMessageCapability', () => {
  afterEach(() => {
    useAiInfraStore.setState(initialStoreState, true);
  });

  it('uses a custom provider OpenAI runtime only when its model declares audio support', () => {
    const model = audioModel('custom-audio', 'custom-provider');
    useAiInfraStore.setState({
      aiProviderRuntimeConfig: {
        'custom-provider': {
          config: {},
          keyVaults: {},
          settings: { sdkType: 'openai' },
        },
      },
      enabledAiModels: [model],
    });

    const { result } = renderHook(() =>
      useVoiceMessageCapability('custom-audio', 'custom-provider'),
    );

    expect(result.current).toBe(true);
  });

  it('disables a custom provider whose runtime has no raw-audio adapter', () => {
    const model = audioModel('custom-audio', 'custom-provider');
    useAiInfraStore.setState({
      aiProviderRuntimeConfig: {
        'custom-provider': {
          config: {},
          keyVaults: {},
          settings: { sdkType: 'anthropic' },
        },
      },
      enabledAiModels: [model],
    });

    const { result } = renderHook(() =>
      useVoiceMessageCapability('custom-audio', 'custom-provider'),
    );

    expect(result.current).toBe(false);
  });

  it('requires a router audio model to match the curated model card', () => {
    const model = audioModel('gemini-audio', ModelProvider.AiHubMix);
    useAiInfraStore.setState({
      builtinAiModelList: [model],
      enabledAiModels: [model],
    });

    const { result } = renderHook(() =>
      useVoiceMessageCapability('gemini-audio', ModelProvider.AiHubMix),
    );

    expect(result.current).toBe(true);
  });

  it('does not require the curated LobeHub card to duplicate the runtime audio capability', () => {
    const id = 'gemini-3.5-flash';
    const curatedModel = {
      abilities: { functionCall: true },
      enabled: true,
      id,
      providerId: ModelProvider.LobeHub,
      type: 'chat',
    } as const;
    useAiInfraStore.setState({
      builtinAiModelList: [curatedModel],
      enabledAiModels: [audioModel(id, ModelProvider.LobeHub)],
    });

    const { result } = renderHook(() => useVoiceMessageCapability(id, ModelProvider.LobeHub));

    expect(result.current).toBe(true);
  });

  it('keeps a curated LobeHub model disabled when runtime audio support is absent', () => {
    const model = {
      abilities: { functionCall: true },
      enabled: true,
      id: 'text-only-model',
      providerId: ModelProvider.LobeHub,
      type: 'chat',
    } as const;
    useAiInfraStore.setState({
      builtinAiModelList: [model],
      enabledAiModels: [model],
    });

    const { result } = renderHook(() =>
      useVoiceMessageCapability('text-only-model', ModelProvider.LobeHub),
    );

    expect(result.current).toBe(false);
  });
});

describe('getVoiceMessageActionState', () => {
  it('disables send and retry if the active model stops supporting audio', () => {
    expect(
      getVoiceMessageActionState({
        canRecordVoiceMessage: false,
        canSendRecording: true,
        hasRecoverableError: true,
      }),
    ).toEqual({
      canSend: false,
      sendDisabled: true,
      showRetry: false,
    });
  });

  it('restores the available action after switching back to an audio model', () => {
    expect(
      getVoiceMessageActionState({
        canRecordVoiceMessage: true,
        canSendRecording: false,
        hasRecoverableError: true,
      }),
    ).toEqual({
      canSend: false,
      sendDisabled: false,
      showRetry: true,
    });
  });
});
