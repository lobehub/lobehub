import { type OpenAITTSOptions, type TTSOptions } from '@lobehub/tts/react';
import { useOpenAITTS } from '@lobehub/tts/react';
import isEqual from 'fast-deep-equal';

import { useBusinessTTSProvider } from '@/business/client/hooks/useBusinessTTSProvider';
import { createHeaderWithOpenAI } from '@/services/_header';
import { API_ENDPOINTS } from '@/services/_url';
import { agentProjectionSelectors, useCurrentAgentValue } from '@/store/agent/projection';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

interface TTSConfig extends TTSOptions {
  onUpload?: (currentVoice: string, arraybuffers: ArrayBuffer[]) => void;
  voice?: string;
}

export const useTTS = (content: string, config?: TTSConfig) => {
  const ttsSettings = useUserStore(settingsSelectors.currentTTS, isEqual);
  const voice = useCurrentAgentValue(agentProjectionSelectors.ttsVoice);
  const businessTTSProvider = useBusinessTTSProvider();
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const currentVoice = config?.voice || voice;

  const options = {
    api: {
      headers: createHeaderWithOpenAI(),
      serviceUrl: API_ENDPOINTS.tts(enableBusinessFeatures ? businessTTSProvider : 'openai'),
    },
    options: {
      model: ttsSettings.openAI.ttsModel,
      voice: currentVoice,
    },
  } as OpenAITTSOptions;

  return useOpenAITTS(content, {
    ...config,
    ...options,
    onFinish: (arraybuffers) => {
      config?.onUpload?.(currentVoice || 'alloy', arraybuffers);
    },
  });
};
