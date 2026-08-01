import dayjs from 'dayjs';
import isToday from 'dayjs/plugin/isToday';
import isYesterday from 'dayjs/plugin/isYesterday';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import { enableMapSet, enablePatches } from 'immer';

import { isChunkLoadError, notifyChunkError } from '@/utils/chunkError';

enablePatches();
enableMapSet();

// Dayjs plugins - extend once at app init to avoid duplicate extensions in components
dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(isToday);
dayjs.extend(isYesterday);

// Global fallback: catch async chunk-load failures that escape Error Boundaries
if (typeof window !== 'undefined') {
  // Never preventDefault here: Vite's preload helper only rethrows when the
  // event default is kept, otherwise the failed import() resolves `undefined`
  // and every React.lazy consumer crashes with `undefined.default` instead of
  // surfacing a recognizable chunk-load error.
  window.addEventListener('vite:preloadError', (event) => {
    if (isChunkLoadError((event as any).payload)) {
      notifyChunkError();
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (isChunkLoadError(event.reason)) {
      event.preventDefault();
      notifyChunkError();
    }
  });
}

if (__DEV__ && __REACT_SCAN__) {
  void import('react-scan').then(({ scan }) => {
    scan({ enabled: true, showToolbar: true });
  });
}
