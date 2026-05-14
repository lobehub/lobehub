import { type ChatMessageError } from '@lobechat/types';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useApplyTranscriptToEditor } from '@/features/ChatInput/Voice/useApplyTranscriptToEditor';
import {
  useOpenaiSTT,
  useSTTErrorHandler,
} from '@/features/ChatInput/Voice/useChatInputSpeechRecognition';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

import CommonSTT from './common';

const OpenaiSTT = memo<{ mobile?: boolean }>(({ mobile }) => {
  const [error, setError] = useState<ChatMessageError>();
  const { t } = useTranslation('chat');
  const transcript = useApplyTranscriptToEditor();
  const { handleSuccess, setDefaultError } = useSTTErrorHandler(setError);

  const loading = useChatStore(operationSelectors.isAgentRuntimeRunning);

  const { start, isLoading, stop, formattedTime, time, response, isRecording } = useOpenaiSTT({
    onError: (err) => {
      stop();
      transcript.end();
      setDefaultError(err);
    },
    onErrorRetry: (err) => {
      stop();
      transcript.end();
      setDefaultError(err);
    },
    onSuccess: async () => {
      await handleSuccess(response, stop);
    },
    onTextChange: (text) => {
      if (loading) stop();
      if (text) transcript.apply(text);
    },
  });

  const desc = t('stt.action');

  const handleTriggerStartStop = useCallback(() => {
    if (loading) return;
    if (!isLoading) {
      transcript.begin();
      start();
    } else {
      stop();
      transcript.end();
    }
  }, [loading, isLoading, start, stop, transcript]);

  const handleCloseError = useCallback(() => {
    setError(undefined);
    stop();
    transcript.end();
  }, [stop, transcript]);

  const handleRetry = useCallback(() => {
    setError(undefined);
    transcript.begin();
    start();
  }, [start, transcript]);

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
