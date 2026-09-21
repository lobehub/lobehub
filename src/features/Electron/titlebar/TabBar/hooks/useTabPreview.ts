import { useEffect, useState } from 'react';

import { isDesktop } from '@/const/version';
import { ensureElectronIpc } from '@/utils/electron/ipc';

export const useTabPreview = (tabId: string, enabled: boolean) => {
  const [preview, setPreview] = useState<string>();

  useEffect(() => {
    if (!isDesktop || !enabled) return;

    let cancelled = false;
    ensureElectronIpc()
      .tabPreview.get(tabId)
      .then((dataUrl: string | undefined) => {
        if (!cancelled) setPreview(dataUrl);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [enabled, tabId]);

  return preview;
};
