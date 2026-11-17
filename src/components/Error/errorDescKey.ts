import { isDesktopIpcUnavailableError } from '@/utils/electron/ipc';

/**
 * A desktop window without the preload bridge cannot mount the app: the first
 * desktop service throws during render and the route lands on the error page.
 * Say how to recover there instead of the generic "try later".
 */
const DESKTOP_IPC_DESC_KEYS = {
  'not-desktop': 'error.desktopIpc.notDesktop',
  'preload-missing': 'error.desktopIpc.preloadMissing',
} as const;

/** The `error` namespace key the route error page shows under its title. */
export const getErrorDescKey = (error: unknown) =>
  isDesktopIpcUnavailableError(error) ? DESKTOP_IPC_DESC_KEYS[error.reason] : 'error.desc';
