import type { Page } from '@playwright/test';

export type ScrollMotion = 'jump' | 'none' | 'slide';

export interface ScrollTraceSummary {
  frames: number;
  largestFrameDelta: number;
  motion: ScrollMotion;
  movingFrames: number;
  travel: number;
}

const TRACE_KEY = '__lobehubE2EScrollTrace';
const MIN_SLIDE_FRAMES = 4;
const JUMP_SHARE = 0.9;

export const classifyScrollTrace = (samples: number[]): ScrollTraceSummary => {
  const deltas = samples.slice(1).map((value, i) => value - samples[i]);
  const moving = deltas.filter((d) => d !== 0);
  const travel = Math.abs(samples.at(-1)! - samples[0]);
  const largestFrameDelta = Math.max(0, ...moving.map(Math.abs));

  let motion: ScrollMotion = 'none';
  if (travel > 0) {
    const oneFrameJump = largestFrameDelta >= travel * JUMP_SHARE;
    motion = !oneFrameJump && moving.length >= MIN_SLIDE_FRAMES ? 'slide' : 'jump';
  }

  return { frames: samples.length, largestFrameDelta, motion, movingFrames: moving.length, travel };
};

// Injected as source text: the tsx/esbuild transform wraps named inner
// functions in a `__name` helper that does not exist in the page.
const START_SCRIPT = `(() => {
  const key = ${JSON.stringify(TRACE_KEY)};
  if (window[key]) cancelAnimationFrame(window[key].raf);
  const trace = { raf: 0, samples: [] };
  const tick = () => {
    let el = document.querySelector('.message-wrapper');
    while (el) {
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') break;
      el = el.parentElement;
    }
    trace.samples.push(el ? el.scrollTop : NaN);
    trace.raf = requestAnimationFrame(tick);
  };
  trace.raf = requestAnimationFrame(tick);
  window[key] = trace;
})()`;

const STOP_SCRIPT = `(() => {
  const key = ${JSON.stringify(TRACE_KEY)};
  const trace = window[key];
  if (!trace) return [];
  cancelAnimationFrame(trace.raf);
  delete window[key];
  return trace.samples.filter((v) => !Number.isNaN(v));
})()`;

export const startScrollTrace = async (page: Page): Promise<void> => {
  await page.evaluate(START_SCRIPT);
};

export const stopScrollTrace = async (page: Page): Promise<number[]> => {
  return page.evaluate<number[]>(STOP_SCRIPT);
};
