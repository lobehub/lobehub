import { isDesktop } from '@lobechat/const';
import { getElectronIpc } from '@lobechat/electron-client-ipc';
import { type DesktopIpcServices } from '@lobehub/desktop-ipc-typings';

import { analyticsClient } from '@/libs/analytics/client';

/**
 * Why the renderer cannot reach the Electron main process:
 *
 * - `not-desktop`: the code runs in a plain web browser (or any non-Electron
 *   build). Expected whenever a desktop-only action is reached from the web —
 *   e.g. a conversation started on the desktop app is continued or approved in
 *   a browser.
 * - `preload-missing`: a desktop build whose window has no preload bridge.
 *   The preload exposes `window.electronAPI.invoke` once per page load and the
 *   IPC proxy is cached after its first success, so this means the bridge never
 *   loaded for this page; reloading the window re-runs the preload.
 */
export type DesktopIpcUnavailableReason = 'not-desktop' | 'preload-missing';

export const DESKTOP_IPC_UNAVAILABLE_EVENT = 'desktop_ipc_unavailable';

const UNAVAILABLE_MESSAGES: Record<DesktopIpcUnavailableReason, string> = {
  'not-desktop':
    'This action needs the LobeHub desktop app, but this page is running in a web browser. Open it in LobeHub Desktop and try again.',
  'preload-missing':
    "LobeHub Desktop's connection to the local system is not available in this window (window.electronAPI.invoke is missing). Reload the window (Cmd/Ctrl+R) to reconnect it, or restart LobeHub Desktop if reloading does not help, then try again.",
};

export class DesktopIpcUnavailableError extends Error {
  readonly reason: DesktopIpcUnavailableReason;

  constructor(reason: DesktopIpcUnavailableReason) {
    super(UNAVAILABLE_MESSAGES[reason]);
    this.name = 'DesktopIpcUnavailableError';
    this.reason = reason;
  }
}

/**
 * Matches by name, not `instanceof`: a dev server can load this module twice
 * (HMR timestamps), and an error thrown by one copy must still be recognised.
 */
export const isDesktopIpcUnavailableError = (error: unknown): error is DesktopIpcUnavailableError =>
  error instanceof Error && error.name === 'DesktopIpcUnavailableError';

const unavailableReason = (): DesktopIpcUnavailableReason =>
  isDesktop ? 'preload-missing' : 'not-desktop';

/** `undefined` when the IPC bridge is usable, otherwise why it is not. */
export const getDesktopIpcUnavailableReason = (): DesktopIpcUnavailableReason | undefined =>
  getElectronIpc() ? undefined : unavailableReason();

let preloadMissingReported = false;

export const trackDesktopIpcUnavailable = (
  reason: DesktopIpcUnavailableReason,
  properties: Record<string, string> = {},
) => {
  void analyticsClient.track({
    name: DESKTOP_IPC_UNAVAILABLE_EVENT,
    properties: { reason, ...properties },
  });
};

export const ensureElectronIpc = (): DesktopIpcServices => {
  const ipc = getElectronIpc();
  if (ipc) return ipc;

  const reason = unavailableReason();
  // A missing bridge on a desktop build is never expected; report it once per
  // page so a burst of callers does not flood analytics. The web case is the
  // normal outcome of reaching a desktop-only action from a browser and is
  // reported by the callers that care (see the desktop-only tool guard).
  if (reason === 'preload-missing' && !preloadMissingReported) {
    preloadMissingReported = true;
    trackDesktopIpcUnavailable(reason, { source: 'ipc' });
  }

  throw new DesktopIpcUnavailableError(reason);
};
