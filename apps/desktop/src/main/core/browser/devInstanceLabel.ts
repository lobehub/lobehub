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

export const formatDevInstanceTitle = (title: string, label: string) =>
  title ? `${title} — ${label}` : label;

/**
 * Suffixes the native window title with the instance label. The frameless title
 * bar hides it, but the window menu, Mission Control and CDP target lists show
 * it, without drawing anything over the page.
 */
export const attachDevInstanceLabel = (browserWindow: BrowserWindow, label: string) => {
  browserWindow.webContents.on('page-title-updated', (event, title) => {
    event.preventDefault();
    browserWindow.setTitle(formatDevInstanceTitle(title, label));
  });
};
