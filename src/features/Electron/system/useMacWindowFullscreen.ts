import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { useEffect, useRef } from 'react';

import { isDesktop } from '@/const/version';
import { electronSystemService } from '@/services/electron/system';
import { isMacOS } from '@/utils/platform';

import { setMacWindowFullscreenAttribute } from './macWindowFullscreen';

const tracksMacWindowFullscreen = () => isDesktop && isMacOS();

export const useMacWindowFullscreen = () => {
  const fullscreenEpoch = useRef(0);

  useWatchBroadcast('windowFullscreenChanged', ({ isFullScreen }) => {
    if (!tracksMacWindowFullscreen()) return;

    fullscreenEpoch.current += 1;
    setMacWindowFullscreenAttribute(isFullScreen);
  });

  useEffect(() => {
    if (!tracksMacWindowFullscreen()) return;

    const epoch = fullscreenEpoch.current;
    let disposed = false;

    electronSystemService
      .isWindowFullScreen()
      .then((isFullScreen) => {
        if (disposed || fullscreenEpoch.current !== epoch) return;

        setMacWindowFullscreenAttribute(isFullScreen);
      })
      .catch((error) => {
        console.error('Failed to read the macOS fullscreen state', error);
        if (disposed || fullscreenEpoch.current !== epoch) return;

        setMacWindowFullscreenAttribute(false);
      });

    return () => {
      disposed = true;
    };
  }, []);
};
