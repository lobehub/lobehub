import { useEffect, useRef, useState } from 'react';

import { useSingleton } from '@/hooks/useSingleton';
import { formatSpeed, formatTime } from '@/utils/format';

export const useDownloadMonitor = (totalSize: number, completedSize: number) => {
  const [downloadSpeed, setDownloadSpeed] = useState<string>('0 KB/s');
  const [remainingTime, setRemainingTime] = useState<string>('-');

  const lastCompletedRef = useRef(completedSize);
  const lastTimedRef = useSingleton(() => ({ current: Date.now() }));

  useEffect(() => {
    const currentTime = Date.now();
    const elapsedTime = (currentTime - lastTimedRef.current) / 1000; // in seconds
    if (completedSize > 0 && elapsedTime > 1) {
      const speed = Math.max(0, (completedSize - lastCompletedRef.current) / elapsedTime); // in bytes per second
      setDownloadSpeed(formatSpeed(speed));

      const remainingSize = totalSize - completedSize;
      const time = remainingSize / speed; // in seconds
      setRemainingTime(formatTime(time));

      lastCompletedRef.current = completedSize;
      lastTimedRef.current = currentTime;
    }
  }, [completedSize]);

  return { downloadSpeed, remainingTime };
};
