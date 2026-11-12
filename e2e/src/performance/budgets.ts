/**
 * Render budgets for a long message list (T-13850), checked by
 * `features/performance/long-message-list.feature`.
 *
 * - `firstReadableMs`: navigation start until the newest message shows its
 *   text on screen. Includes the app boot and the message fetch, because that
 *   is what the reader waits for. The step first opens the agent's empty chat
 *   so app bundles and the server are warm; the topic's messages stay cold.
 * - `maxGapMs` / `longFrameShare`: the worst stall, and the share of frame
 *   gaps above 50 ms, while the reader wheels through the whole topic.
 * - `maxMountedRows`: message rows in the DOM at once. Virtualization keeps
 *   this flat regardless of topic length; losing it mounts every row.
 * - `rowMountsPerMessage`: row mounts during one full pass divided by the
 *   messages in the topic. A pass mounts each row about once (a tool round of
 *   three messages is one row, so a clean pass stays below 1); remount churn
 *   from unstable keys or index shifts multiplies it.
 *
 * Counts never moved across local runs (2026-11-13, 3 runs each: mounted rows
 * 8 / 7, mounts per message 0.93-0.94 up and 0.79-0.80 down), so they get tight
 * ceilings shared by every machine. Timings swing between the same runs (first
 * readable 1.5-1.8 s after the warm-up, worst gap 50-200 ms, long-frame share
 * 0-2.2%), so their ceilings only catch a list that got far slower than any
 * baseline.
 * CI runs on GitHub-hosted `ubuntu-latest` (selected by `CI`) and gets its own
 * timing ceilings. Its first receipts (2026-11-13, PR #22937) measured first
 * readable 1.9-2.1 s, worst gap 33-100 ms and long-frame share 0-2.5%; the
 * ceilings leave room for a slower shared runner, not for a lost virtualizer.
 */
export interface LongListTimingBudget {
  firstReadableMs: number;
  scroll: { longFrameShare: number; maxGapMs: number };
}

export interface LongListCountBudget {
  maxMountedRows: number;
  rowMountsPerMessage: number;
}

export type LongListSize = 500 | 1000;

/** The same for both sizes: what is mounted must not grow with topic length. */
const countBudget: LongListCountBudget = { maxMountedRows: 12, rowMountsPerMessage: 1.2 };

const localTimingBudget: Record<LongListSize, LongListTimingBudget> = {
  500: { firstReadableMs: 3500, scroll: { longFrameShare: 0.05, maxGapMs: 400 } },
  1000: { firstReadableMs: 3500, scroll: { longFrameShare: 0.05, maxGapMs: 400 } },
};

const ciTimingBudget: Record<LongListSize, LongListTimingBudget> = {
  500: { firstReadableMs: 5000, scroll: { longFrameShare: 0.08, maxGapMs: 400 } },
  1000: { firstReadableMs: 5000, scroll: { longFrameShare: 0.08, maxGapMs: 400 } },
};

export const getLongListBudget = (size: LongListSize) => ({
  counts: countBudget,
  timing: (process.env.CI ? ciTimingBudget : localTimingBudget)[size],
});
