'use client';

import { useEffect } from 'react';

import { electronSystemService } from '@/services/electron/system';
import { type ElectronStore, useElectronStore } from '@/store/electron';

const selectActiveScopeSlug = (s: ElectronStore): string | null =>
  s.activeTabScope.type === 'workspace' ? s.activeTabScope.slug : null;

// Mirror the active tab scope into the main-process store so the next launch
// can boot the window directly at `/{slug}` (BrowserManager reads it when
// resolving the main window's initial path). Personal scope clears the memory.
export const useLastWorkspaceSlugSync = (): void => {
  const slug = useElectronStore(selectActiveScopeSlug);

  useEffect(() => {
    electronSystemService.setLastWorkspaceSlug(slug).catch((err) => {
      console.error('[desktop] persist last workspace slug failed', err);
    });
  }, [slug]);
};
