'use client';

import { isDesktop } from '@lobechat/const';
import { useContext } from 'react';

import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';

import { AppOriginContext } from './appOriginContext';

/**
 * Returns the correct app origin URL for sharing/linking.
 * - Web: uses the SSR host's origin, or window.location.origin in client-only hosts
 * - Desktop: uses remoteServerUrl from electron store, without trailing slashes
 *   (a self-hosted URL may be configured as `https://example.com/`)
 */
export const useAppOrigin = () => {
  const origin = useContext(AppOriginContext);
  const remoteServerUrl = useElectronStore((state) =>
    isDesktop ? electronSyncSelectors.remoteServerUrl(state) : '',
  );
  if (isDesktop) return remoteServerUrl.replace(/\/+$/, '');
  return origin ?? (typeof window === 'undefined' ? '' : window.location.origin);
};
