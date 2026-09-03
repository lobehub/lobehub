import { renderHook } from '@testing-library/react';
import { ModelProvider } from 'model-bank/modelProvider';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAiInfraStore } from '@/store/aiInfra';

import {
  getVoiceMessageActionState,
  getVoiceMessageCapability,
  getVoiceMessageIdleState,
  supportsRawAudioMessage,
  useVoiceMessageCapability,
} from './useVoiceMessageCapability';

const serverConfig = vi.hoisted(() => ({
  enableMultimodalUnderstanding: false,
  multimodalUnderstanding: undefined as { model: string; provider: string } | undefined,
}));

const agentModePreference = vi.hoisted(() => ({
  enableAgentMode: true,
  isPreferenceLoading: false,
  usesWorkspaceMemberMode: false,
}));

vi.mock('@/features/ChatInput/hooks/effectiveAgentModePreference', () => ({
  useEffectiveAgentModePreference: () => agentModePreference,
}));

vi.mock('@/store/serverConfig', () => ({
  getServerConfigStoreState: () => ({ serverConfig }),
  serverConfigSelectors: {
    enableMultimodalUnderstanding: (state: { serverConfig: typeof serverConfig }) =>
      state.serverConfig.enableMultimodalUnderstanding,
    multimodalUnderstanding: (state: { serverConfig: typeof serverConfig }) =>
      state.serverConfig.multimodalUnderstanding,
  },
  useServerConfigStore: (selector: (state: { serverConfig: typeof serverConfig }) => unknown) =>
    selector({ serverConfig }),
}));

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

  it('enables a curated audio model on the AiHubMix router', () => {
    expect(
      supportsRawAudioMessage({
        isCuratedModel: true,
        modelSupportsAudio: true,
        provider: ModelProvider.AiHubMix,
        runtimeProvider: ModelProvider.AiHubMix,
      }),
    ).toBe(true);
  });

  it('trusts the server-curated audio capability on the LobeHub router', () => {
    expect(
      supportsRawAudioMessage({
        isCuratedModel: false,
        modelSupportsAudio: true,
        provider: ModelProvider.LobeHub,
        runtimeProvider: ModelProvider.LobeHub,
      }),
    ).toBe(true);
  });

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
    agentModePreference.enableAgentMode = true;
    agentModePreference.isPreferenceLoading = false;
    agentModePreference.usesWorkspaceMemberMode = false;
    serverConfig.enableMultimodalUnderstanding = false;
    serverConfig.multimodalUnderstanding = undefined;
  });

  it('enables DeepSeek V4 through configured multimodal understanding', () => {
    const model = {
      abilities: { functionCall: true },
      enabled: true,
      id: 'deepseek-v4-flash',
      providerId: ModelProvider.LobeHub,
      type: 'chat',
    } as const;
    useAiInfraStore.setState({ enabledAiModels: [model] });
    serverConfig.enableMultimodalUnderstanding = true;
    serverConfig.multimodalUnderstanding = {
      model: 'fallback-audio-model',
      provider: 'fallback-provider',
    };

    const { result } = renderHook(() => useVoiceMessageCapability(model.id, model.providerId));

    expect(result.current).toBe(true);
    expect(
      getVoiceMessageCapability({
        enableAgentMode: true,
        model: model.id,
        provider: model.providerId,
      }),
    ).toBe(true);
  });

  it('disables the multimodal fallback when Agent mode is off', () => {
    const model = {
      abilities: { functionCall: true },
      enabled: true,
      id: 'deepseek-v4-pro',
      providerId: ModelProvider.LobeHub,
      type: 'chat',
    } as const;
    useAiInfraStore.setState({ enabledAiModels: [model] });
    serverConfig.enableMultimodalUnderstanding = true;
    serverConfig.multimodalUnderstanding = {
      model: 'fallback-audio-model',
      provider: 'fallback-provider',
    };

    expect(
      getVoiceMessageCapability({
        enableAgentMode: false,
        model: model.id,
        provider: model.providerId,
      }),
    ).toBe(false);
  });

  it('keeps the Agent-only fallback disabled while the member mode preference is loading', () => {
    const model = {
      abilities: { functionCall: true },
      enabled: true,
      id: 'workspace-text-model',
      providerId: ModelProvider.LobeHub,
      type: 'chat',
    } as const;
    useAiInfraStore.setState({ enabledAiModels: [model] });
    serverConfig.enableMultimodalUnderstanding = true;
    serverConfig.multimodalUnderstanding = {
      model: 'fallback-audio-model',
      provider: 'fallback-provider',
    };

    expect(
      getVoiceMessageCapability({
        enableAgentMode: true,
        isAgentModePreferenceLoading: true,
        model: model.id,
        provider: model.providerId,
      }),
    ).toBe(false);

    agentModePreference.isPreferenceLoading = true;
    const { result } = renderHook(() =>
      useVoiceMessageCapability(model.id, model.providerId, 'workspace-agent'),
    );

    expect(result.current).toBe(false);
  });

  it('keeps native audio enabled when Agent mode is off', () => {
    const model = audioModel('native-audio', ModelProvider.Google);
    useAiInfraStore.setState({ enabledAiModels: [model] });

    expect(
      getVoiceMessageCapability({
        enableAgentMode: false,
        model: model.id,
        provider: model.providerId,
      }),
    ).toBe(true);
  });

  it('keeps native audio enabled while the member mode preference is loading', () => {
    const model = audioModel('native-audio-loading', ModelProvider.Google);
    useAiInfraStore.setState({ enabledAiModels: [model] });

    expect(
      getVoiceMessageCapability({
        enableAgentMode: true,
        isAgentModePreferenceLoading: true,
        model: model.id,
        provider: model.providerId,
      }),
    ).toBe(true);
  });

  it('keeps a text-only model disabled when it cannot call the fallback tool', () => {
    const model = {
      abilities: { functionCall: false },
      enabled: true,
      id: 'text-model-without-tools',
      providerId: ModelProvider.LobeHub,
      type: 'chat',
    } as const;
    useAiInfraStore.setState({ enabledAiModels: [model] });
    serverConfig.enableMultimodalUnderstanding = true;
    serverConfig.multimodalUnderstanding = {
      model: 'fallback-audio-model',
      provider: 'fallback-provider',
    };

    const { result } = renderHook(() => useVoiceMessageCapability(model.id, model.providerId));

    expect(result.current).toBe(false);
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
    useAiInfraStore.setState({
      builtinAiModelList: [],
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

describe('getVoiceMessageIdleState', () => {
  const base = {
    canRecordVoiceMessage: true,
    hasSendHandler: true,
    isGenerating: false,
    isOtherAudioModeActive: false,
  };

  it('drops the trigger when the model cannot take audio at all', () => {
    expect(getVoiceMessageIdleState({ ...base, canRecordVoiceMessage: false })).toEqual({
      canStart: false,
      hidden: true,
    });
  });

  it('drops the trigger on a composer that has no voice-message handler', () => {
    expect(getVoiceMessageIdleState({ ...base, hasSendHandler: false })).toEqual({
      canStart: false,
      hidden: true,
    });
  });

  it('keeps the trigger visible but inert while a reply is generating', () => {
    expect(getVoiceMessageIdleState({ ...base, isGenerating: true })).toEqual({
      canStart: false,
      hidden: false,
    });
  });

  it('keeps the trigger visible but inert while another audio mode owns the bar', () => {
    expect(getVoiceMessageIdleState({ ...base, isOtherAudioModeActive: true })).toEqual({
      canStart: false,
      hidden: false,
    });
  });

  it('offers the trigger when the model supports audio and nothing else is running', () => {
    expect(getVoiceMessageIdleState(base)).toEqual({ canStart: true, hidden: false });
  });
});
