'use client';

import { memo, useEffect } from 'react';

import { useChatStore } from '@/store/chat';

const INITIAL_WATCHDOG_DELAY = 15_000;
const WATCHDOG_INTERVAL = 5 * 60_000;

const TopicStatusWatchdog = memo(() => {
  const cleanupStaleRunningTopics = useChatStore((s) => s.cleanupStaleRunningTopics);

  useEffect(() => {
    let disposed = false;

    const run = () => {
      if (disposed) return;
      void cleanupStaleRunningTopics();
    };

    const initialTimer = window.setTimeout(run, INITIAL_WATCHDOG_DELAY);
    const interval = window.setInterval(run, WATCHDOG_INTERVAL);

    return () => {
      disposed = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, [cleanupStaleRunningTopics]);

  return null;
});

TopicStatusWatchdog.displayName = 'TopicStatusWatchdog';

export default TopicStatusWatchdog;
