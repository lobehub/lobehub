import UAParser from 'ua-parser-js';

import { isOnServerSide } from './env';

export const getParser = () => {
  if (isOnServerSide) return new UAParser('Node');

  const ua = navigator.userAgent;
  return new UAParser(ua);
};

export const getPlatform = () => {
  return getParser().getOS().name;
};

export const getBrowser = () => {
  return getParser().getResult().browser.name;
};

export const browserInfo = {
  browser: getBrowser(),
  isMobile: getParser().getDevice().type === 'mobile',
  os: getParser().getOS().name,
};

export const isMacOS = () => getPlatform() === 'Mac OS';

/**
 * Get macOS Darwin major version number
 * @returns Darwin major version (e.g., 25, 26) or 0 if not available
 */
export const getDarwinMajorVersion = (): number => {
  if (isOnServerSide || typeof window === 'undefined') return 0;

  // In Electron environment, use window.lobeEnv.darwinMajorVersion if available
  if (typeof (window as any)?.lobeEnv?.darwinMajorVersion === 'number') {
    return (window as any).lobeEnv.darwinMajorVersion;
  }

  // In web environment, try to parse from userAgent
  if (typeof navigator !== 'undefined') {
    const match = navigator.userAgent.match(/Mac OS X (\d+)[._](\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return 0;
};

/**
 *
 * We can't use it to detect the macOS real version, and we also don't know if it's macOS 26, only an estimated value.
 * @returns true if the current browser is macOS and the version is 10.15 or later (web) or darwinMajorVersion >= 25 (Electron)
 */
export const isMacOSWithLargeWindowBorders = () => {
  if (isOnServerSide || typeof navigator === 'undefined') return false;

  // Check if we're in Electron environment
  const isElectron =
    /Electron\//.test(navigator.userAgent) || Boolean((window as any)?.process?.type);

  // In Electron environment, check darwinMajorVersion from window.lobeEnv
  if (isElectron) {
    const darwinMajorVersion = getDarwinMajorVersion();
    // macOS 25+ has large window borders
    return darwinMajorVersion >= 25;
  }

  // keep consistent with the original logic: only for macOS on web (exclude Electron)
  if (!isMacOS()) return false;

  const match = navigator.userAgent.match(/Mac OS X (\d+)[._](\d+)/);
  if (!match) return false;

  const majorVersion = parseInt(match[1], 10);
  const minorVersion = parseInt(match[2], 10);

  return majorVersion >= 10 && minorVersion >= 15;
};

export const isArc = () => {
  if (isOnServerSide) return false;
  return (
    window.matchMedia('(--arc-palette-focus: var(--arc-background-simple-color))').matches ||
    Boolean('arc' in window || 'ArcControl' in window || 'ARCControl' in window) ||
    Boolean(getComputedStyle(document.documentElement).getPropertyValue('--arc-palette-title'))
  );
};

export const isInStandaloneMode = () => {
  if (isOnServerSide) return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as any).standalone === true)
  );
};

export const isSonomaOrLaterSafari = () => {
  if (isOnServerSide) return false;

  // refs: https://github.com/khmyznikov/pwa-install/blob/0904788b9d0e34399846f6cb7dbb5efeabb62c20/src/utils.ts#L24
  const userAgent = navigator.userAgent.toLowerCase();
  if (navigator.maxTouchPoints || !/macintosh/.test(userAgent)) return false;

  // check safari version >= 17
  const version = /version\/(\d{2})\./.exec(userAgent);
  if (!version || !version[1] || !(parseInt(version[1]) >= 17)) return false;

  try {
    // hacky way to detect Sonoma
    const audioCheck = document.createElement('audio').canPlayType('audio/wav; codecs="1"');
    const webGLCheck = new OffscreenCanvas(1, 1).getContext('webgl');
    return Boolean(audioCheck) && Boolean(webGLCheck);
  } catch {
    return false;
  }
};
