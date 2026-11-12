import {
  RenderProfileRecorder,
  type RenderProfileRegion,
  type RenderProfileReport,
  type RenderProfileStatus,
} from './recorder';

export {
  RENDER_PROFILE_REGIONS,
  type RenderProfileRegion,
  type RenderProfileReport,
  type RenderProfileStatus,
} from './recorder';

/**
 * Label of the scenario a profiling build starts on its own at boot, so a test
 * can measure the first page open, which begins before any test code can run in
 * the document.
 */
export const BOOT_RENDER_PROFILE_LABEL = 'boot';

export interface RenderProfileController {
  begin: (label: string) => void;
  /** `profiling`: production bundle on react-dom/profiling; `development`: Vite dev server. */
  buildMode: 'development' | 'profiling';
  end: () => RenderProfileReport;
  status: () => RenderProfileStatus;
}

declare global {
  interface Window {
    __LOBE_RENDER_PROFILE__?: RenderProfileController;
  }
}

/**
 * True when `<Profiler>` callbacks fire: development builds, or a production
 * build made with `LOBE_REACT_PROFILING=1`. Ordinary production bundles fold
 * this to `false`, so the region wrappers render bare children and the
 * installer returns before creating anything.
 */
export const isRenderProfileEnabled = () =>
  __DEV__ || (typeof __REACT_PROFILING__ !== 'undefined' && __REACT_PROFILING__);

let recorder: RenderProfileRecorder | undefined;
let frameLoopRunning = false;

/**
 * One loop at a time: a scenario that begins before the previous loop sees its
 * end would otherwise run two loops and count every frame twice.
 */
const startFrameLoop = (target: RenderProfileRecorder) => {
  if (frameLoopRunning) return;
  frameLoopRunning = true;

  const tick = (timestamp: number) => {
    if (!target.active) {
      frameLoopRunning = false;
      return;
    }
    target.recordAnimationFrame(timestamp);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const observeLongAnimationFrames = (target: RenderProfileRecorder) => {
  if (!PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')) return;

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) target.recordLongAnimationFrame(entry.duration);
  }).observe({ type: 'long-animation-frame' });
};

/**
 * Exposes `window.__LOBE_RENDER_PROFILE__` for render-budget E2E runs. A
 * profiling build also starts the `boot` scenario immediately.
 */
export const installRenderProfile = () => {
  if (!isRenderProfileEnabled() || typeof window === 'undefined' || recorder) return;

  const target = new RenderProfileRecorder(() => performance.now());
  recorder = target;
  observeLongAnimationFrames(target);

  const begin = (label: string) => {
    target.begin(label);
    startFrameLoop(target);
  };

  window.__LOBE_RENDER_PROFILE__ = {
    begin,
    buildMode: __DEV__ ? 'development' : 'profiling',
    end: () => target.end(),
    status: () => target.status(),
  };

  if (!__DEV__) begin(BOOT_RENDER_PROFILE_LABEL);
};

export const recordRegionRender = (
  region: RenderProfileRegion,
  phase: 'mount' | 'update' | 'nested-update',
  actualDuration: number,
  commitTime: number,
) => {
  recorder?.recordRender(region, phase, actualDuration, commitTime);
};
