import type { DebugLoggingDuration } from '@lobechat/electron-client-ipc';

import type { StoreManager } from '@/core/infrastructure/StoreManager';
import { createLogger } from '@/utils/logger';
import { applyDebugLogging } from '@/utils/structuredLog';

const logger = createLogger('modules:debugLogging');

/** Lifetime of a timed Debug logs setting; `'always'` has none. */
export const DEBUG_LOGGING_DURATION_MS: Record<Exclude<DebugLoggingDuration, 'always'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
};

/** `setTimeout` overflows above 2^31-1 ms (~24.8 days) and would fire at once. */
const MAX_TIMER_MS = 2_147_483_647;

type DebugLoggingStore = Pick<StoreManager, 'delete' | 'get' | 'set'>;

let expiryTimer: ReturnType<typeof setTimeout> | undefined;

const clearExpiryTimer = () => {
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = undefined;
};

/**
 * Applies the persisted Debug logs setting to this run. A timed setting that has
 * passed its expiry is turned off here, at launch or when its timer fires, without
 * a notification: the Settings row shows the current state.
 */
export const syncDebugLogging = (store: DebugLoggingStore, now = Date.now()) => {
  clearExpiryTimer();
  const enabled = store.get('debugLoggingEnabled', false);
  const expiresAt = store.get('debugLoggingExpiresAt');

  if (enabled && expiresAt !== undefined && expiresAt <= now) {
    store.set('debugLoggingEnabled', false);
    store.delete('debugLoggingExpiresAt');
    applyDebugLogging(false);
    logger.info('Debug logging turned off after its duration ended');
    return;
  }

  applyDebugLogging(enabled);
  if (enabled && expiresAt !== undefined) {
    // A longer wait re-arms itself when the capped timer fires.
    expiryTimer = setTimeout(
      () => syncDebugLogging(store),
      Math.min(expiresAt - now, MAX_TIMER_MS),
    );
    expiryTimer.unref?.();
  }
};

/** Turns debug logging off, or on for `duration`. */
export const setDebugLogging = (
  store: DebugLoggingStore,
  duration: DebugLoggingDuration | 'off',
  now = Date.now(),
) => {
  store.set('debugLoggingEnabled', duration !== 'off');
  if (duration === 'off' || duration === 'always') store.delete('debugLoggingExpiresAt');
  else store.set('debugLoggingExpiresAt', now + DEBUG_LOGGING_DURATION_MS[duration]);
  syncDebugLogging(store, now);
};

/** Test-only: drop a pending expiry timer. */
export const resetDebugLoggingForTest = clearExpiryTimer;
