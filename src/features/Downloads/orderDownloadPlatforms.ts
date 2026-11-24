import type { DesktopDownloadUrls } from '@lobechat/types';

export type DownloadPlatform = keyof DesktopDownloadUrls;

/** Offered in this order when the visitor's own platform is unknown. */
const DEFAULT_ORDER: readonly DownloadPlatform[] = ['windows', 'macOS', 'linux'];

/**
 * Which platform the visitor is most likely to want.
 *
 * Deliberately coarse: this only decides which button to put first, so a wrong
 * guess costs a glance rather than a failed download — every configured
 * platform is still listed.
 */
export const detectPlatform = (userAgent: string): DownloadPlatform | undefined => {
  if (/mac|iphone|ipad|ipod/i.test(userAgent)) return 'macOS';
  if (/win/i.test(userAgent)) return 'windows';
  // Android reports "Linux" too, and cannot install a desktop package.
  if (/linux|x11/i.test(userAgent) && !/android/i.test(userAgent)) return 'linux';

  return undefined;
};

/**
 * The platforms to show, the visitor's own first.
 *
 * A Mac user landing on a list headed by a `.exe` has to read past the wrong
 * answer to find theirs, and the first button is the one people click.
 *
 * Platforms with no URL configured are dropped: a build that exists for Windows
 * and not macOS should say so by omission rather than by offering a link that
 * 404s.
 */
export const orderDownloadPlatforms = (
  urls: DesktopDownloadUrls,
  userAgent: string,
): DownloadPlatform[] => {
  const configured = DEFAULT_ORDER.filter((platform) => urls[platform]);
  const own = detectPlatform(userAgent);
  if (!own || !configured.includes(own)) return configured;

  return [own, ...configured.filter((platform) => platform !== own)];
};
