import { useCallback, useEffect, useRef, useState } from 'react';

interface CambAITTSOptions {
  api?: {
    headers?: HeadersInit;
    serviceUrl?: string;
  };
  onError?: (err: Error) => void;
  onErrorRetry?: (err: Error) => void;
  onFinish?: (arrayBuffers: ArrayBuffer[]) => void;
  onSuccess?: () => void;
  options?: {
    language?: string;
    model?: string;
    voice?: string;
  };
}

export const useCambAITTS = (content: string, options?: CambAITTSOptions) => {
  const [isGlobalLoading, setIsGlobalLoading] = useState(false);
  const [audio, setAudio] = useState<HTMLAudioElement>();
  const [response, setResponse] = useState<Response>();
  const [text, setText] = useState(content);
  const abortControllerRef = useRef<AbortController | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  // Cleanup on unmount: abort fetch, revoke URLs
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
    };
  }, []);

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setIsGlobalLoading(false);
  }, [audio]);

  const start = useCallback(async () => {
    if (!content) return;

    setIsGlobalLoading(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const serviceUrl = options?.api?.serviceUrl || '/webapi/tts/cambai';
      const res = await fetch(serviceUrl, {
        body: JSON.stringify({
          language: (options?.options?.language || 'en-US').toLowerCase().replace('_', '-'),
          speech_model: options?.options?.model || 'mars-flash',
          text: content,
          voice_id: Number(options?.options?.voice) || 147_320,
        }),
        headers: {
          'Content-Type': 'application/json',
          ...options?.api?.headers,
        },
        method: 'POST',
        signal: controller.signal,
      });

      setResponse(res);

      if (!res.ok) {
        options?.onError?.(new Error(`TTS request failed: ${res.status}`));
        setIsGlobalLoading(false);
        return;
      }

      const arrayBuffer = await res.arrayBuffer();
      const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);

      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
      audioUrlRef.current = url;

      const audioElement = new Audio(url);
      setAudio(audioElement);

      // Use { once: true } to auto-remove listener after firing
      audioElement.addEventListener(
        'ended',
        () => {
          setIsGlobalLoading(false);
        },
        { once: true },
      );

      try {
        await audioElement.play();
      } catch (playError) {
        setIsGlobalLoading(false);
        options?.onError?.(new Error('Audio playback failed. Check browser autoplay settings.'));
        return;
      }

      options?.onFinish?.([arrayBuffer]);
      options?.onSuccess?.();
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        setIsGlobalLoading(false);
        return;
      }
      options?.onError?.(error as Error);
      setIsGlobalLoading(false);
    }
  }, [content, options]);

  return { audio, isGlobalLoading, response, setText, start, stop };
};
