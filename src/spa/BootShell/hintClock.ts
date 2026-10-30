import { HANDOVER_WINDOW } from '@/components/Skeleton/skeletonHandover';

// Long enough that a normal cold boot never sees it — the caption reads as
// "slower than usual", so showing it on every boot turns it into noise.
export const HINT_DELAY = 3000;

let mounted = 0;
let shownSince = 0;
let lastSeenAt = -Infinity;

/**
 * One wait clock shared by every shell instance. `BootShell` and the main
 * layout's Suspense fallback are separate mounts of the same screen; a
 * per-mount timer restarts on that handoff and the caption vanishes, then
 * slides in again a full delay later. An instance that mounts while another is
 * up, or right after one left, continues the wait instead of starting over.
 *
 * Returns when the wait started.
 */
export const acquireHintClock = (now = performance.now()) => {
  if (mounted === 0 && now - lastSeenAt >= HANDOVER_WINDOW) shownSince = now;
  mounted += 1;

  return shownSince;
};

export const releaseHintClock = (now = performance.now()) => {
  mounted = Math.max(0, mounted - 1);
  lastSeenAt = now;
};

/** Test-only: forget every previous wait. */
export const resetHintClock = () => {
  mounted = 0;
  shownSince = 0;
  lastSeenAt = -Infinity;
};
