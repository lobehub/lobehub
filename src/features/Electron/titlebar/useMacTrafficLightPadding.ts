import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { useEffect, useState } from 'react';

import { electronSystemService } from '@/services/electron/system';
import { isMacOS } from '@/utils/platform';

import { getMacTrafficLightPadding } from './layout';

const isMac = isMacOS();

export const useMacTrafficLightPadding = () => {
  const [isWindowFullScreen, setIsWindowFullScreen] = useState(false);

  useWatchBroadcast('windowFullscreenChanged', ({ isFullScreen }) => {
    if (isMac) setIsWindowFullScreen(isFullScreen);
  });

  useEffect(() => {
    if (!isMac) return;

    let disposed = false;

    const syncFullScreenState = async () => {
      try {
        const isFullScreen = await electronSystemService.isWindowFullScreen();
        if (!disposed) setIsWindowFullScreen(isFullScreen);
      } catch {
        if (!disposed) setIsWindowFullScreen(false);
      }
    };

    void syncFullScreenState();

    return () => {
      disposed = true;
    };
  }, []);

  return getMacTrafficLightPadding(isMac, isWindowFullScreen);
};
