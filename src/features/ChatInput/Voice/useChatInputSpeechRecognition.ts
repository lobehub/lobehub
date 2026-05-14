import { getMessageError } from '@lobechat/fetch-sse';
import type { ChatMessageError } from '@lobechat/types';
import { getRecordMineType } from '@lobehub/tts';
import type { OpenAISTTOptions, SpeechRecognitionOptions } from '@lobehub/tts/react';
import { useOpenAISTT, useSpeechRecognition } from '@lobehub/tts/react';
import isEqual from 'fast-deep-equal';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { SWRConfiguration } from 'swr';

import { createHeaderWithOpenAI } from '@/services/_header';
import { API_ENDPOINTS } from '@/services/_url';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { useAgentId } from '../hooks/useAgentId';

export interface STTConfig extends SWRConfiguration {
  onTextChange: (value: string) => void;
}

export const useResolvedSTTLocale = () => {
  const ttsSettings = useUserStore(settingsSelectors.currentTTS, isEqual);
  const agentId = useAgentId();
  const ttsAgentSettings = useAgentStore(
    (s) => agentByIdSelectors.getAgentTTSById(agentId)(s),
    isEqual,
  );
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);

  const sttLocale =
    ttsAgentSettings?.sttLocale && ttsAgentSettings.sttLocale !== 'auto'
      ? ttsAgentSettings.sttLocale
      : locale;

  return { autoStop: ttsSettings.sttAutoStop, sttLocale, ttsSettings };
};

export const useBrowserSTT = (config: STTConfig) => {
  const { autoStop, sttLocale } = useResolvedSTTLocale();

  return useSpeechRecognition(sttLocale, {
    ...config,
    autoStop,
  } as SpeechRecognitionOptions);
};

export const useOpenaiSTT = (config: STTConfig) => {
  const { autoStop, sttLocale, ttsSettings } = useResolvedSTTLocale();

  return useOpenAISTT(sttLocale, {
    ...config,
    api: {
      headers: createHeaderWithOpenAI(),
      serviceUrl: API_ENDPOINTS.stt,
    },
    autoStop,
    options: {
      mineType: getRecordMineType(),
      model: ttsSettings.openAI.sttModel,
    },
  } as OpenAISTTOptions);
};

export const useSTTErrorHandler = (
  setError: Dispatch<SetStateAction<ChatMessageError | undefined>>,
) => {
  const { t } = useTranslation('chat');

  const setDefaultError = useCallback(
    (err?: unknown) => {
      setError({ body: err, message: t('stt.responseError', { ns: 'error' }), type: 500 });
    },
    [setError, t],
  );

  const handleSuccess = useCallback(
    async (response: Response | undefined, stop: () => void) => {
      if (!response) return;
      if (response.status === 200) return;

      const message = await getMessageError(response);
      if (message) {
        setError(message);
      } else {
        setDefaultError();
      }
      stop();
    },
    [setDefaultError, setError],
  );

  return { handleSuccess, setDefaultError };
};
