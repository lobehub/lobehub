export interface BootMetricSpan {
  durMs: number;
  name: string;
  startMs: number;
}

export interface BootMetricPayload {
  anonId?: string;
  appVersion: string;
  cold: boolean;
  isLogin: boolean;
  platform: 'desktop' | 'mobile' | 'web';
  spans: BootMetricSpan[];
  totalMs: number;
  userId?: string;
}

interface BuildPayloadInput {
  dimensions: {
    anonId?: string;
    appVersion: string;
    cold: boolean;
    isLogin: boolean;
    platform: 'desktop' | 'mobile' | 'web';
    userId?: string;
  };
  fcpMs?: number;
  htmlMarkMs?: number;
  navResponseStartMs?: number;
  resourceTimings?: { durMs: number; name: string; startMs: number }[];
  snapshot: { marks: Record<string, number>; spans: BootMetricSpan[] };
}

const SPAN_TIME_CAP_MS = 120_000;

export const BOOT_SPAN_NAMES: ReadonlySet<string> = new Set([
  'import-settings',
  'tool-surfaces',
  'core-init',
  'cache-hydration',
  'ttfb',
  'doc',
  'bundle',
  'store-gate',
  'fcp',
]);

const isFinitePositive = (n: number) => Number.isFinite(n) && n >= 0;

const isAllowedSpan = (s: BootMetricSpan) =>
  BOOT_SPAN_NAMES.has(s.name) && s.durMs <= SPAN_TIME_CAP_MS && s.startMs <= SPAN_TIME_CAP_MS;

export const buildBootMetricsPayload = (input: BuildPayloadInput): BootMetricPayload | null => {
  const { snapshot, htmlMarkMs, navResponseStartMs, fcpMs, resourceTimings, dimensions } = input;
  const { marks, spans: snapshotSpans } = snapshot;

  const totalMs = (() => {
    const fp = marks['first-paint'];
    if (typeof fp === 'number' && Number.isFinite(fp)) return fp;
    if (typeof fcpMs === 'number' && isFinitePositive(fcpMs)) return fcpMs;
    return null;
  })();

  if (totalMs === null || totalMs > SPAN_TIME_CAP_MS) return null;

  const existingNames = new Set(snapshotSpans.map((s) => s.name));

  const derived: BootMetricSpan[] = [];

  const tryAdd = (name: string, startMs: number, durMs: number) => {
    if (existingNames.has(name)) return;
    if (!isFinitePositive(durMs)) return;
    derived.push({ durMs, name, startMs });
  };

  if (typeof navResponseStartMs === 'number') {
    tryAdd('ttfb', 0, navResponseStartMs);
  }

  if (typeof htmlMarkMs === 'number') {
    tryAdd('doc', 0, htmlMarkMs);
  }

  const bundleEval = marks['bundle-eval'];
  if (typeof htmlMarkMs === 'number' && typeof bundleEval === 'number') {
    tryAdd('bundle', htmlMarkMs, bundleEval - htmlMarkMs);
  }

  const appReady = marks['app-ready'];
  const firstPaint = marks['first-paint'];
  if (typeof appReady === 'number' && typeof firstPaint === 'number') {
    tryAdd('store-gate', appReady, firstPaint - appReady);
  }

  if (typeof fcpMs === 'number') {
    tryAdd('fcp', 0, fcpMs);
  }

  if (resourceTimings) {
    for (const rt of resourceTimings) {
      if (!existingNames.has(rt.name) && isFinitePositive(rt.durMs)) {
        derived.push({ durMs: rt.durMs, name: rt.name, startMs: rt.startMs });
      }
    }
  }

  // performance.now() yields sub-millisecond floats; the metrics columns are integer, so round.
  const spans = [...snapshotSpans, ...derived]
    .filter(isAllowedSpan)
    .slice(0, 64)
    .map((s) => ({ durMs: Math.round(s.durMs), name: s.name, startMs: Math.round(s.startMs) }));

  return {
    ...dimensions,
    spans,
    totalMs: Math.round(totalMs),
  };
};
