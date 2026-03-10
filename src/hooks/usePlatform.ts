import { useMemo, useRef } from 'react';

import {
  getBrowser,
  getPlatform,
  isArc,
  isInStandaloneMode,
  isSonomaOrLaterSafari,
} from '@/utils/platform';

export const usePlatform = () => {
  const platform = useRef(getPlatform());
  const browser = useRef(getBrowser());

  const platformInfo = {
    isAndroid: platform.current?.toLowerCase() === 'android',
    isApple: platform.current && ['mac os', 'ios'].includes(platform.current?.toLowerCase()),
    isArc: isArc(),
    isChrome: browser.current?.toLowerCase() === 'chrome',
    isChromium:
      browser.current &&
      ['chrome', 'edge', 'opera', 'brave'].includes(browser.current?.toLowerCase()),
    isEdge: browser.current?.toLowerCase() === 'edge',
    isFirefox: browser.current?.toLowerCase() === 'firefox',
    isIOS: platform.current?.toLowerCase() === 'ios',
    isMacOS: platform.current?.toLowerCase() === 'mac os',
    isPWA: isInStandaloneMode(),
    isSafari: browser.current?.toLowerCase() === 'safari',
    isSonomaOrLaterSafari: isSonomaOrLaterSafari(),
  };

  return useMemo(
    () => ({
      ...platformInfo,
      isSupportInstallPWA:
        !platformInfo.isArc &&
        !platformInfo.isFirefox &&
        ((platformInfo.isChromium && !platformInfo.isIOS) ||
          (platformInfo.isMacOS && platformInfo.isSonomaOrLaterSafari)),
    }),
    [],
  );
};
