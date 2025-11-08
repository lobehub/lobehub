import { ChatMessageError } from '@lobechat/types';
import { getRecordMineType } from '@lobehub/tts';
import { OpenAISTTOptions, useOpenAISTT } from '@lobehub/tts/react';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SWRConfiguration } from 'swr';

import { createHeaderWithOpenAI } from '@/services/_header';
import { API_ENDPOINTS } from '@/services/_url';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/slices/message/selectors';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { getMessageError } from '@/utils/fetch';

import CommonSTT from './common';

interface STTConfig extends SWRConfiguration {
  onTextChange: (value: string) => void;
}

const useOpenaiSTT = (config: STTConfig) => {
  const ttsSettings = useUserStore(settingsSelectors.currentTTS, isEqual);
  const ttsAgentSettings = useAgentStore(agentSelectors.currentAgentTTS, isEqual);
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);

  const autoStop = ttsSettings.sttAutoStop;
  const sttLocale =
    ttsAgentSettings?.sttLocale && ttsAgentSettings.sttLocale !== 'auto'
      ? ttsAgentSettings.sttLocale
      : locale;

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

const OpenaiSTT = memo<{ mobile?: boolean }>(({ mobile }) => {
  const [error, setError] = useState<ChatMessageError>();
  const { t } = useTranslation('chat');

  const [loading, updateInputMessage] = useChatStore((s) => [
    chatSelectors.isAIGenerating(s),
    s.updateInputMessage,
  ]);

  const setDefaultError = useCallback(
    (err?: any) => {
      setError({ body: err, message: t('stt.responseError', { ns: 'error' }), type: 500 });
    },
    [t],
  );

  const { start, isLoading, stop, formattedTime, time, response, isRecording } = useOpenaiSTT({
    onError: (err) => {
      stop();
      setDefaultError(err);
    },
    onErrorRetry: (err) => {
      stop();
      setDefaultError(err);
    },
    onSuccess: async () => {
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
    onTextChange: (text) => {
      if (loading) stop();
      if (text) updateInputMessage(text);
    },
  });

  const desc = t('stt.action');

  const handleTriggerStartStop = useCallback(() => {
    if (loading) return;
    if (!isLoading) {
      start();
    } else {
      stop();
    }
  }, [loading, isLoading, start, stop]);

  const handleCloseError = useCallback(() => {
    setError(undefined);
    stop();
  }, [stop]);

  const handleRetry = useCallback(() => {
    setError(undefined);
    start();
  }, [start]);

  return (
    <CommonSTT
      desc={desc}
      error={error}
      formattedTime={formattedTime}
      handleCloseError={handleCloseError}
      handleRetry={handleRetry}
      handleTriggerStartStop={handleTriggerStartStop}
      isLoading={isLoading}
      isRecording={isRecording}
      mobile={mobile}
      time={time}
    />
  );
});

export default OpenaiSTT;
