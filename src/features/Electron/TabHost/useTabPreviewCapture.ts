import { type RefObject, useEffect } from 'react';

import { isDesktop } from '@/const/version';
import { ensureElectronIpc } from '@/utils/electron/ipc';

/**
 * Capturing at switch-away time races the tab swap: `capturePage` resolves against
 * whichever frame the compositor services next, which is already the incoming tab.
 * So visible panes register here and the shot is taken when the pointer enters the
 * tab bar, which precedes any click that would swap tabs. Keyboard switches skip the
 * bar and simply reuse whatever was cached last.
 */
const visibleCaptures = new Map<string, () => void>();

export const captureVisibleTabPreviews = () => {
  for (const capture of visibleCaptures.values()) capture();
};

export const useTabPreviewCapture = (
  tabId: string,
  isVisible: boolean,
  ref: RefObject<HTMLDivElement | null>,
) => {
  useEffect(() => {
    const element = ref.current;
    if (!isDesktop || !isVisible || !element) return;

    visibleCaptures.set(tabId, () => {
      if (document.hidden) return;
      const rect = element.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return;

      ensureElectronIpc()
        .tabPreview.capture({
          rect: { height: rect.height, width: rect.width, x: rect.x, y: rect.y },
          tabId,
        })
        .catch(() => {});
    });

    return () => {
      visibleCaptures.delete(tabId);
    };
  }, [isVisible, tabId, ref]);
};
