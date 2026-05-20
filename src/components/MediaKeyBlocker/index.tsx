'use client';

import { useEffect } from 'react';

import { isMediaKey } from '@/utils/keyboard';

/**
 * Blocks media/system key events at the capture phase so they never reach
 * react-hotkeys-hook or any other bubble-phase keyboard listener.
 *
 * Must be placed as a child of <HotkeysProvider>.
 */
const MediaKeyBlocker = () => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isMediaKey(e)) {
        e.stopImmediatePropagation();
      }
    };

    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true });
  }, []);

  return null;
};

export default MediaKeyBlocker;
