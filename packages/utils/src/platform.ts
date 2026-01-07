import UAParser from 'ua-parser-js';

import { isOnServerSide } from './env';

export const getParser = () => {
  if (isOnServerSide) return new UAParser('Node');

  let ua = navigator.userAgent;
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
 *
 * We can't use it to detect the macOS real version, and we also don't know if it's macOS 26, only an estimated value.
 * @returns true if the current browser is macOS and the version is 10.15 or later
 */
export const isMacOSWithLargeWindowBorders = () => {
  if (isOnServerSide || typeof navigator === 'undefined') return false;

  // keep consistent with the original logic: only for macOS on web (exclude Electron)
  const isElectron =
    /Electron\//.test(navigator.userAgent) || Boolean((window as any)?.process?.type);
  if (isElectron || !isMacOS()) return false;

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
