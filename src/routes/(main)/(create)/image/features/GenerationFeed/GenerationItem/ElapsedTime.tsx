'use client';

import { Text } from '@lobehub/ui';
import { useEffect, useRef, useState } from 'react';

interface ElapsedTimeProps {
  generationId: string;
  isActive: boolean;
}

const getSessionStorageKey = (generationId: string) => `generation_start_time_${generationId}`;

/**
 * Display elapsed time for image generation
 * - Less than 1 minute: show seconds with 0.1s precision
 * - 1 minute or more: show minutes with 1 decimal precision
 * - Uses sessionStorage to maintain accurate timing across page refreshes
 */
export function ElapsedTime({ generationId, isActive }: ElapsedTimeProps) {
  const [elapsedTime, setElapsedTime] = useState<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);

  useEffect(() => {
    if (!isActive) {
      // If not active, clear the timer and reset elapsed time
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }

      // Clear data from sessionStorage
      const storageKey = getSessionStorageKey(generationId);
      sessionStorage.removeItem(storageKey);
      setElapsedTime(null);
      return;
    }

    const storageKey = getSessionStorageKey(generationId);

    // Only set start time when the component mounts
    const clientStartTime = (() => {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) return Number(stored);

      const now = Date.now();
      sessionStorage.setItem(storageKey, now.toString());
      return now;
    })();

    const update = (timestamp: number) => {
      if (timestamp - lastUpdateRef.current >= 100) {
        const elapsed = (Date.now() - clientStartTime) / 100;
        setElapsedTime(Math.max(0, elapsed));
        lastUpdateRef.current = timestamp;
      }
      frameRef.current = requestAnimationFrame(update);
    };

    frameRef.current = requestAnimationFrame(update);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [generationId, isActive]);

  // Format elapsed time display
  const formattedTime = (() => {
    if (elapsedTime === null) return '';

    const totalSeconds = elapsedTime / 10;

    // Less than 60 seconds: show seconds with 0.1s precision
    if (totalSeconds < 60) {
      return `${totalSeconds.toFixed(1)}s`;
    }

    // 60 seconds or more: show minutes with 1 decimal precision
    const minutes = totalSeconds / 60;
    return `${minutes.toFixed(1)}min`;
  })();

  return (
    <Text code fontSize={10} type={'secondary'}>
      {formattedTime}
    </Text>
  );
}
