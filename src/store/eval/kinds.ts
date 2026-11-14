/**
 * Lobe Bench and the Evaluation Lab share the eval tables (benchmarks,
 * datasets, experiments, runs). A benchmark or experiment created for Lobe
 * Bench carries `metadata.kind = 'lobe-bench'`; each surface lists only its
 * own side, so the shared storage never shows through.
 */
export const LOBE_BENCH_KIND = 'lobe-bench';

export const isLobeBenchKind = (item?: { metadata?: unknown } | null): boolean =>
  !!item &&
  typeof item.metadata === 'object' &&
  item.metadata !== null &&
  (item.metadata as { kind?: unknown }).kind === LOBE_BENCH_KIND;
