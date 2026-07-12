import { isDesktop } from '@lobechat/const';

export const LOBE_DEVICE_ID_KEY = 'lobe_device_id';

/**
 * Get or create a stable anonymous device ID for the current machine.
 *
 * - On desktop (Electron): returns the local gateway deviceId from the store.
 * - On web / mobile: creates a random UUID on first visit and persists it in
 *   `localStorage.lobe_device_id`. Subsequent visits return the same ID,
 *   so different browsers on the same machine get different IDs (correct),
 *   but the same browser on the same machine always gets the same ID.
 * - If localStorage is unavailable (SSR, private mode storage disabled):
 *   returns `'anonymous'` as a fallback.
 */
export const getSourceDeviceId = (): string | undefined => {
  if (isDesktop) {
    // Desktop gets its deviceId from the Electron gateway store — handled by
    // the caller. This path is only reached from non-desktop contexts.
    return undefined;
  }

  try {
    const stored = localStorage.getItem(LOBE_DEVICE_ID_KEY);
    if (stored) return stored;

    const id = crypto.randomUUID();
    localStorage.setItem(LOBE_DEVICE_ID_KEY, id);
    return id;
  } catch {
    // localStorage unavailable (SSR, private mode, etc.)
    return 'anonymous';
  }
};
