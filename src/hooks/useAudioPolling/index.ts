'use client';

import { useEffect, useRef, useState } from 'react';

interface UseAudioPollingParams {
  taskId?: string;
  interval?: number;
  maxRetries?: number;
  onStatusChange?: (status: string) => void;
  onComplete?: (audioUrl?: string) => void;
}

export const useAudioPolling = ({
  taskId,
  interval = 3000,
  maxRetries = 60,
  onStatusChange,
  onComplete,
}: UseAudioPollingParams) => {
  const [status, setStatus] = useState<string>('pending');
  const [progress, setProgress] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const retriesRef = useRef(0);
  const timeoutRef = useRef<NodeJS.Timeout>();
  const pollStartTimeRef = useRef<number>();

  useEffect(() => {
    if (!taskId) return;

    const poll = async () => {
      try {
        // TODO: Call TRPC API to check task status
        // const result = await generationService.checkStatus(taskId);
        // setStatus(result.status);
        // setProgress(result.progress);
        // if (result.status === 'completed') {
        //   setAudioUrl(result.audioUrl);
        //   onComplete?.(result.audioUrl);
        //   setIsPolling(false);
        //   return;
        // }
        
        // Placeholder polling logic
        retriesRef.current++;
        const calculatedProgress = Math.min((retriesRef.current / maxRetries) * 100, 95);
        setProgress(calculatedProgress);

        if (!pollStartTimeRef.current) {
          pollStartTimeRef.current = Date.now();
        }

        const elapsedSeconds = (Date.now() - pollStartTimeRef.current) / 1000;
        if (elapsedSeconds > 10) {
          setStatus('processing');
          onStatusChange?.('processing');
        }

        if (retriesRef.current >= maxRetries) {
          setStatus('completed');
          setProgress(100);
          onComplete?.();
          setIsPolling(false);
          return;
        }

        timeoutRef.current = setTimeout(poll, interval);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Polling failed';
        setError(message);
        setStatus('failed');
        setIsPolling(false);
      }
    };

    setIsPolling(true);
    retriesRef.current = 0;
    pollStartTimeRef.current = Date.now();
    poll();

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [taskId, interval, maxRetries, onStatusChange, onComplete]);

  return {
    status,
    progress,
    audioUrl,
    error,
    isPolling,
  };
};
