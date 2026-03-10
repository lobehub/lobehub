import { getMessageError } from '@lobechat/fetch-sse';
import { type ChatMessageError } from '@lobechat/types';
import { type SpeechRecognitionOptions } from '@lobehub/tts/react';
import { useSpeechRecognition } from '@lobehub/tts/react';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type SWRConfiguration } from 'swr';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import CommonSTT from './common';

interface STTConfig extends SWRConfiguration {
  onTextChange: (value: string) => void;
}

const useBrowserSTT = (config: STTConfig) => {
  const ttsSettings = useUserStore(settingsSelectors.currentTTS, isEqual);
  const agentId = useAgentId();
  const ttsAgentSettings = useAgentStore(
    (s) => agentByIdSelectors.getAgentTTSById(agentId)(s),
    isEqual,
  );
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);

  const autoStop = ttsSettings.sttAutoStop;
  const sttLocale =
    ttsAgentSettings?.sttLocale && ttsAgentSettings.sttLocale !== 'auto'
      ? ttsAgentSettings.sttLocale
      : locale;

  return useSpeechRecognition(sttLocale, {
    ...config,
    autoStop,
  } as SpeechRecognitionOptions);
};

const BrowserSTT = memo<{ mobile?: boolean }>(({ mobile }) => {
  const [error, setError] = useState<ChatMessageError>();
  const { t } = useTranslation('chat');

  const [loading, updateMessageInput] = useChatStore((s) => [
    operationSelectors.isAgentRuntimeRunning(s),
    s.updateMessageInput,
  ]);

  const setDefaultError = useCallback(
    (err?: any) => {
      setError({ body: err, message: t('stt.responseError', { ns: 'error' }), type: 500 });
    },
    [t],
  );

  const { start, isLoading, stop, formattedTime, time, response, isRecording } = useBrowserSTT({
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
      if (text) updateMessageInput(text);
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

export default BrowserSTT;
