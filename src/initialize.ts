import dayjs from 'dayjs';
import isToday from 'dayjs/plugin/isToday';
import isYesterday from 'dayjs/plugin/isYesterday';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import { enableMapSet } from 'immer';

import { isChunkLoadError, notifyChunkError } from '@/utils/chunkError';

enableMapSet();

// Dayjs plugins - extend once at app init to avoid duplicate extensions in components
dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(isToday);
dayjs.extend(isYesterday);

// Global fallback: catch async chunk-load failures that escape Error Boundaries
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    notifyChunkError();
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (isChunkLoadError(event.reason)) {
      event.preventDefault();
      notifyChunkError();
    }
  });
}
