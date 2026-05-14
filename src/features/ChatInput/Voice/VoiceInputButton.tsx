'use client';

import type { ChatMessageError } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { Mic, MicOff } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import CircularVoiceAction from './CircularVoiceAction';
import { useApplyTranscriptToEditor } from './useApplyTranscriptToEditor';
import { useBrowserSTT, useOpenaiSTT, useSTTErrorHandler } from './useChatInputSpeechRecognition';

interface VoiceInputRecorderProps {
  kind: 'browser' | 'openai';
}

const BrowserRecorder = memo(() => {
  const { t } = useTranslation('chat');
  const [error, setError] = useState<ChatMessageError>();
  const transcript = useApplyTranscriptToEditor();
  const { handleSuccess, setDefaultError } = useSTTErrorHandler(setError);

  const { start, isLoading, stop, formattedTime, time, response, isRecording } = useBrowserSTT({
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
      if (text) transcript.apply(text);
    },
  });

  const handleTriggerStartStop = useCallback(() => {
    if (!isLoading) {
      setError(undefined);
      transcript.begin();
      start();
      return;
    }

    stop();
    transcript.end();
  }, [isLoading, start, stop, transcript]);

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
    <CircularVoiceAction
      active={isRecording}
      desc={t('voice.input.action')}
      error={error}
      formattedTime={formattedTime}
      handleCloseError={handleCloseError}
      handleRetry={handleRetry}
      icon={isLoading ? MicOff : Mic}
      isLoading={isLoading}
      isRecording={isRecording}
      time={time}
      onClick={handleTriggerStartStop}
    />
  );
});

BrowserRecorder.displayName = 'BrowserRecorder';

const OpenAIRecorder = memo(() => {
  const { t } = useTranslation('chat');
  const [error, setError] = useState<ChatMessageError>();
  const transcript = useApplyTranscriptToEditor();
  const { handleSuccess, setDefaultError } = useSTTErrorHandler(setError);

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
      if (text) transcript.apply(text);
    },
  });

  const handleTriggerStartStop = useCallback(() => {
    if (!isLoading) {
      setError(undefined);
      transcript.begin();
      start();
      return;
    }

    stop();
    transcript.end();
  }, [isLoading, start, stop, transcript]);

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
    <CircularVoiceAction
      active={isRecording}
      desc={t('voice.input.action')}
      error={error}
      formattedTime={formattedTime}
      handleCloseError={handleCloseError}
      handleRetry={handleRetry}
      icon={isLoading ? MicOff : Mic}
      isLoading={isLoading}
      isRecording={isRecording}
      time={time}
      onClick={handleTriggerStartStop}
    />
  );
});

OpenAIRecorder.displayName = 'OpenAIRecorder';

const VoiceInputRecorder = memo<VoiceInputRecorderProps>(({ kind }) => {
  return kind === 'openai' ? <OpenAIRecorder /> : <BrowserRecorder />;
});

VoiceInputRecorder.displayName = 'VoiceInputRecorder';

const VoiceInputButton = memo(() => {
  const { sttServer, voiceInput } = useUserStore(settingsSelectors.currentTTS, isEqual);
  const { enableSTT } = useServerConfigStore(featureFlagsSelectors);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);

  if (!enableSTT || voiceInput.enabled === false) return null;

  return <VoiceInputRecorder kind={enableBusinessFeatures ? 'browser' : sttServer} />;
});

VoiceInputButton.displayName = 'VoiceInputButton';

export default VoiceInputButton;
