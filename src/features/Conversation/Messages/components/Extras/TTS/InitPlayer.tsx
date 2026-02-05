import { getMessageError } from '@lobechat/fetch-sse';
import type {ChatMessageError, ChatTTS} from '@lobechat/types';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTTS } from '@/hooks/useTTS';
import { useFileStore } from '@/store/file';

import { useConversationStore } from '../../../../store';
import Player from './Player';

export interface TTSProps extends ChatTTS {
  content: string;
  id: string;
  loading?: boolean;
}

const InitPlayer = memo<TTSProps>(({ id, content, contentMd5, file }) => {
  const [isStart, setIsStart] = useState(false);
  const [error, setError] = useState<ChatMessageError>();
  const isDeletedRef = useRef(false);
  const uploadTTS = useFileStore((s) => s.uploadTTSByArrayBuffers);
  const { t } = useTranslation('chat');

  const [ttsMessage, clearTTS] = useConversationStore((s) => [s.ttsMessage, s.clearTTS]);

  const setDefaultError = useCallback(
    (err?: any) => {
      setError({ body: err, message: t('tts.responseError', { ns: 'error' }), type: 500 });
    },
    [t],
  );

  const { isGlobalLoading, audio, start, stop, response } = useTTS(content, {
    onError: (err) => {
      if (isDeletedRef.current) return;
      stop();
      setDefaultError(err);
    },
    onErrorRetry: (err) => {
      if (isDeletedRef.current) return;
      stop();
      setDefaultError(err);
    },
    onSuccess: async () => {
      if (isDeletedRef.current) return;
      if (!response || response.ok) return;
      const message = await getMessageError(response);
      if (message) {
        setError(message);
      } else {
        setDefaultError();
      }
      stop();
    },
    onUpload: async (currentVoice, arrayBuffers) => {
      if (isDeletedRef.current) return;
      const fileID = await uploadTTS(id, arrayBuffers);
      if (isDeletedRef.current) return;
      ttsMessage(id, { contentMd5, file: fileID, voice: currentVoice });
    },
  });

  const handleInitStart = useCallback(() => {
    if (isStart) return;
    start();
    setIsStart(true);
  }, [isStart, start]);

  const handleDelete = useCallback(() => {
    isDeletedRef.current = true;
    stop();
    clearTTS(id);
  }, [stop, id, clearTTS]);

  const handleRetry = useCallback(() => {
    setError(undefined);
    start();
  }, [start]);

  useEffect(() => {
    // Skip if file exists or user has deleted TTS
    if (file || isDeletedRef.current) return;
    const timer = setTimeout(() => {
      // Double check in case user deleted during the delay
      if (isDeletedRef.current) return;
      handleInitStart();
    }, 100);
    return () => clearTimeout(timer);
  }, [file, handleInitStart]);

  return (
    <Player
      audio={audio}
      error={error}
      isLoading={isGlobalLoading}
      onDelete={handleDelete}
      onInitPlay={handleInitStart}
      onRetry={handleRetry}
    />
  );
});

export default InitPlayer;
