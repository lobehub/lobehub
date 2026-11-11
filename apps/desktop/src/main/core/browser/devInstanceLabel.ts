import type { BrowserWindow } from 'electron';

import * as electronIs from '@/utils/platform';

/**
 * Several dev instances (one per checkout) run side by side and all look the
 * same, so a launcher names each one through `LOBE_DESKTOP_INSTANCE_LABEL`
 * (`scripts/devInstance.mts`). Packaged builds never show it.
 */
export const getDevInstanceLabel = (environment: NodeJS.ProcessEnv = process.env) => {
  if (!electronIs.dev()) return undefined;
  const label = environment.LOBE_DESKTOP_INSTANCE_LABEL?.trim();
  return label || undefined;
};

export const DEV_INSTANCE_BADGE_ID = 'lobe-dev-instance-label';

/**
 * Window controls drawn by the frameless title bar outside macOS (the title bar
 * overlay is about 138px wide); the badge sits left of them.
 */
const WINDOW_CONTROLS_WIDTH = 140;

/**
 * Adds a click-through badge outside `#root`, which React does not own, so it
 * survives renders and route changes. It sits in the top-right corner of the
 * title bar, clear of the centered page titles and the macOS traffic lights. The
 * label is passed as a JSON literal and set as text, never parsed as markup.
 */
export const buildDevInstanceBadgeScript = (
  label: string,
  platform: NodeJS.Platform = process.platform,
) => `(() => {
  if (document.getElementById(${JSON.stringify(DEV_INSTANCE_BADGE_ID)})) return;
  const badge = document.createElement('div');
  badge.id = ${JSON.stringify(DEV_INSTANCE_BADGE_ID)};
  badge.textContent = ${JSON.stringify(label)};
  badge.title = badge.textContent;
  Object.assign(badge.style, {
    background: 'rgba(250, 140, 22, 0.92)',
    borderRadius: '0 0 ${platform === 'darwin' ? '0 6px' : '6px 6px'}',
    // Dark text: white on this orange measured about 2.5:1, below the 4.5:1 text minimum.
    color: 'rgba(0, 0, 0, 0.88)',
    font: '600 11px/18px -apple-system, BlinkMacSystemFont, sans-serif',
    maxWidth: '40vw',
    overflow: 'hidden',
    padding: '0 8px',
    pointerEvents: 'none',
    position: 'fixed',
    right: '${platform === 'darwin' ? 0 : WINDOW_CONTROLS_WIDTH}px',
    textOverflow: 'ellipsis',
    top: '0',
    whiteSpace: 'nowrap',
    zIndex: '2147483647',
  });
  document.documentElement.append(badge);
})()`;

export const formatDevInstanceTitle = (title: string, label: string) =>
  title ? `${title} — ${label}` : label;

/**
 * Marks a window with its instance label: a badge in the page, and a suffix on
 * the native title that the window menu, Mission Control and CDP target lists
 * show even though the frameless title bar hides it.
 */
export const attachDevInstanceLabel = (browserWindow: BrowserWindow, label: string) => {
  const { webContents } = browserWindow;

  webContents.on('page-title-updated', (event, title) => {
    event.preventDefault();
    browserWindow.setTitle(formatDevInstanceTitle(title, label));
  });

  webContents.on('dom-ready', () => {
    webContents.executeJavaScript(buildDevInstanceBadgeScript(label)).catch(() => {
      // The page navigated away before the script ran; the next dom-ready retries.
    });
  });
};
