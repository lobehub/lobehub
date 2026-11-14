import type { Page } from '@playwright/test';

/**
 * Mirrors `RenderProfileReport` in `src/libs/renderProfile/recorder.ts`. The E2E
 * package cannot import app source, so the shape is repeated here.
 */
export const RENDER_REGIONS = ['sidebar', 'conversation', 'messages'] as const;

export type RenderRegion = (typeof RENDER_REGIONS)[number];

export interface RegionReport {
  actualDurationMs: number;
  maxActualDurationMs: number;
  mounts: number;
  renders: number;
  updates: number;
}

export interface RenderReport {
  commitCount: number;
  durationMs: number;
  frames: { count: number; maxGapMs: number };
  label: string;
  longestAnimationFrameMs: number;
  regions: Record<RenderRegion, RegionReport>;
}

interface ProfileStatus {
  active: boolean;
  buildMode?: string;
  lastCommitAt?: number;
  now: number;
}

/** No React commit for this long means the switch has finished rendering. */
const QUIET_MS = 500;
const SETTLE_TIMEOUT_MS = 10_000;

// Injected as source text: the tsx/esbuild transform wraps named inner
// functions in a `__name` helper that does not exist in the page.
const STATUS_SCRIPT = `(() => {
  const profile = window.__LOBE_RENDER_PROFILE__;
  if (!profile) return { active: false, now: performance.now() };
  return { ...profile.status(), buildMode: profile.buildMode, now: performance.now() };
})()`;

const readStatus = (page: Page) => page.evaluate<ProfileStatus>(STATUS_SCRIPT);

/**
 * Fails fast when the server is not a `LOBE_REACT_PROFILING=1` build: an
 * ordinary bundle never fires `<Profiler>` callbacks, so every count would be
 * zero and every budget would pass.
 */
export const assertProfilingBuild = async (page: Page) => {
  const status = await readStatus(page);
  if (status.buildMode !== 'profiling') {
    throw new Error(
      `window.__LOBE_RENDER_PROFILE__ is ${status.buildMode ?? 'missing'}; ` +
        'build the app with LOBE_REACT_PROFILING=1 before running @perf scenarios',
    );
  }
};

export const beginProfile = (page: Page, label: string) =>
  page.evaluate((name) => window.__LOBE_RENDER_PROFILE__!.begin(name), label);

/** Waits until no region has committed for `QUIET_MS`, then ends the scenario. */
export const endProfileWhenSettled = async (page: Page): Promise<RenderReport> => {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;

  for (;;) {
    const status = await readStatus(page);
    const lastCommitAt = status.lastCommitAt ?? 0;
    if (status.now - lastCommitAt >= QUIET_MS) break;
    if (Date.now() > deadline) {
      throw new Error(`React kept committing for ${SETTLE_TIMEOUT_MS}ms after the action`);
    }
    await page.waitForTimeout(100);
  }

  return page.evaluate(() => window.__LOBE_RENDER_PROFILE__!.end() as RenderReport);
};

declare global {
  interface Window {
    __LOBE_RENDER_PROFILE__?: {
      begin: (label: string) => void;
      buildMode: string;
      end: () => unknown;
      status: () => { active: boolean; lastCommitAt?: number };
    };
  }
}
