import type { Page } from '@playwright/test';

/**
 * In-page probes for the message list render budget.
 *
 * Every script is injected as source text: the tsx/esbuild transform wraps
 * named inner functions in a `__name` helper that does not exist in the page
 * (see `probes/scrollTrace.ts`).
 */

const FIRST_READABLE_KEY = '__lobehubE2EFirstReadable';
const WINDOW_KEY = '__lobehubE2ERenderWindow';

/** The virtua scroller of the conversation (`VLIST_CLASS_NAME`). */
export const SCROLLER_SELECTOR = '.conversation-vlist';
/** Root element of every rendered message row (`ChatItem`). */
const ROW_SELECTOR = '.message-wrapper';

/**
 * Register before navigation. Records `performance.now()` — milliseconds since
 * the navigation started — at the first animation frame in which the newest
 * message shows its marker text inside the viewport.
 */
export const installFirstReadableProbe = async (
  page: Page,
  target: { marker: string; messageId: string },
): Promise<void> => {
  await page.addInitScript(`(() => {
    const key = ${JSON.stringify(FIRST_READABLE_KEY)};
    const selector = ${JSON.stringify(`[data-message-id="${target.messageId}"]`)};
    const marker = ${JSON.stringify(target.marker)};
    const state = { at: null };
    window[key] = state;
    const check = () => {
      const el = document.querySelector(selector);
      if (el && el.textContent && el.textContent.includes(marker)) {
        const rect = el.getBoundingClientRect();
        if (rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight) {
          state.at = performance.now();
          return;
        }
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  })()`);
};

export const readFirstReadableMs = (page: Page): Promise<number | null> =>
  page.evaluate<number | null>(`window[${JSON.stringify(FIRST_READABLE_KEY)}]?.at ?? null`);

export interface RenderWindowSample {
  /** Largest number of message rows mounted at once during the window. */
  maxMountedRows: number;
  /** Message rows added to the DOM during the window (virtual list mounts). */
  rowMounts: number;
  /** `requestAnimationFrame` timestamps sampled during the window. */
  timestamps: number[];
}

/** Start sampling animation frames and message-row mounts. */
export const startRenderWindow = (page: Page): Promise<void> =>
  page.evaluate(`(() => {
    const key = ${JSON.stringify(WINDOW_KEY)};
    const rowSelector = ${JSON.stringify(ROW_SELECTOR)};
    const previous = window[key];
    if (previous) {
      cancelAnimationFrame(previous.raf);
      previous.observer.disconnect();
    }
    const state = { maxMountedRows: 0, raf: 0, rowMounts: 0, timestamps: [] };
    state.observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(rowSelector)) state.rowMounts += 1;
          state.rowMounts += node.querySelectorAll(rowSelector).length;
        }
      }
    });
    state.observer.observe(document.body, { childList: true, subtree: true });
    const tick = (timestamp) => {
      state.timestamps.push(timestamp);
      const mounted = document.querySelectorAll(rowSelector).length;
      if (mounted > state.maxMountedRows) state.maxMountedRows = mounted;
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
    window[key] = state;
  })()`);

export const stopRenderWindow = (page: Page): Promise<RenderWindowSample> =>
  page.evaluate<RenderWindowSample>(`(() => {
    const key = ${JSON.stringify(WINDOW_KEY)};
    const state = window[key];
    if (!state) return { maxMountedRows: 0, rowMounts: 0, timestamps: [] };
    cancelAnimationFrame(state.raf);
    state.observer.disconnect();
    delete window[key];
    return {
      maxMountedRows: state.maxMountedRows,
      rowMounts: state.rowMounts,
      timestamps: state.timestamps,
    };
  })()`);

export interface ScrollerState {
  clientHeight: number;
  /** Message ids currently mounted, in DOM order. */
  mountedIds: string[];
  scrollHeight: number;
  scrollTop: number;
}

export const readScrollerState = (page: Page): Promise<ScrollerState | null> =>
  page.evaluate<ScrollerState | null>(`(() => {
    const scroller = document.querySelector(${JSON.stringify(SCROLLER_SELECTOR)});
    if (!scroller) return null;
    return {
      clientHeight: scroller.clientHeight,
      mountedIds: [...scroller.querySelectorAll('[data-message-id]')].map((el) =>
        el.getAttribute('data-message-id'),
      ),
      scrollHeight: scroller.scrollHeight,
      scrollTop: scroller.scrollTop,
    };
  })()`);

/** Resolve after the next two animation frames, so layout and paint have run. */
export const nextFrames = (page: Page): Promise<void> =>
  page.evaluate(
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))`,
  );
