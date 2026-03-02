import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import {
  type EdgeSpeechOptions,
  type MicrosoftSpeechOptions,
  type OpenAITTSOptions,
  type TTSOptions,
} from '@lobehub/tts/react';
import { useEdgeSpeech, useMicrosoftSpeech, useOpenAITTS } from '@lobehub/tts/react';
import isEqual from 'fast-deep-equal';

import { useBusinessTTSProvider } from '@/business/client/hooks/useBusinessTTSProvider';
import { useCambAITTS } from '@/hooks/useCambAITTS';
import { createHeaderWithOpenAI } from '@/services/_header';
import { createHeaderWithCambAI } from '@/services/_headerCambai';
import { API_ENDPOINTS } from '@/services/_url';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { type TTSServer } from '@/types/agent';

interface TTSConfig extends TTSOptions {
  onUpload?: (currentVoice: string, arraybuffers: ArrayBuffer[]) => void;
  server?: TTSServer;
  voice?: string;
}

export const useTTS = (content: string, config?: TTSConfig) => {
  const ttsSettings = useUserStore(settingsSelectors.currentTTS, isEqual);
  const ttsAgentSettings = useAgentStore(agentSelectors.currentAgentTTS, isEqual);
  const lang = useGlobalStore(globalGeneralSelectors.currentLanguage);
  const voice = useAgentStore(agentSelectors.currentAgentTTSVoice(lang));
  const businessTTSProvider = useBusinessTTSProvider();
  let useSelectedTTS: any;
  let options: any = {};
  switch (config?.server || ttsAgentSettings.ttsService) {
    case 'openai': {
      useSelectedTTS = useOpenAITTS;
      options = {
        api: {
          headers: createHeaderWithOpenAI(),
          serviceUrl: API_ENDPOINTS.tts(ENABLE_BUSINESS_FEATURES ? businessTTSProvider : 'openai'),
        },
        options: {
          model: ttsSettings.openAI.ttsModel,
          voice: config?.voice || voice,
        },
      } as OpenAITTSOptions;
      break;
    }
    case 'edge': {
      useSelectedTTS = useEdgeSpeech;
      options = {
        api: {
          /**
           * @description client fetch
           * serviceUrl: TTS_URL.edge,
           */
        },
        options: {
          voice: config?.voice || voice,
        },
      } as EdgeSpeechOptions;
      break;
    }
    case 'microsoft': {
      useSelectedTTS = useMicrosoftSpeech;
      options = {
        api: {
          serviceUrl: API_ENDPOINTS.microsoft,
        },
        options: {
          voice: config?.voice || voice,
        },
      } as MicrosoftSpeechOptions;
      break;
    }
    case 'cambai': {
      useSelectedTTS = useCambAITTS;
      options = {
        api: {
          headers: createHeaderWithCambAI(),
          serviceUrl: API_ENDPOINTS.tts('cambai'),
        },
        options: {
          language: lang,
          model: ttsSettings.cambAI?.ttsModel || 'mars-flash',
          voice: config?.voice || voice,
        },
      };
      break;
    }
  }

  return useSelectedTTS(content, {
    ...config,
    ...options,
    onFinish: (arraybuffers: ArrayBuffer[]) => {
      config?.onUpload?.(options.voice || 'alloy', arraybuffers);
    },
  });
};
