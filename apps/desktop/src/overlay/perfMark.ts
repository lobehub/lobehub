const isBrowser = typeof window !== 'undefined';

const isEnabled = (() => {
  if (!isBrowser) return false;
  try {
    if (window.localStorage?.getItem('lobe-overlay-bench') === '1') return true;
    if (new URLSearchParams(window.location.search).has('bench')) return true;
  } catch {
    /* localStorage may throw in restricted contexts */
  }
  return false;
})();

const START_MARK = 'overlay:entry-start';

if (isBrowser && isEnabled) {
  performance.mark(START_MARK);
}

export const perfMark = (name: string): void => {
  if (!isEnabled) return;
  performance.mark(name);
  if (name !== START_MARK) {
    try {
      performance.measure(`Δ ${name}`, START_MARK, name);
    } catch {
      /* start mark may not yet exist */
    }
  }
};

interface BenchRow {
  delta_ms: string;
  name: string;
  t_ms: string;
}

interface BenchResult {
  marks: PerformanceEntry[];
  measures: PerformanceEntry[];
  table: BenchRow[];
}

if (isBrowser && isEnabled) {
  (window as unknown as { __OVERLAY_BENCH__: () => BenchResult }).__OVERLAY_BENCH__ = () => {
    const marks = performance
      .getEntriesByType('mark')
      .filter((m) => m.name.startsWith('overlay:') || m.name.startsWith('select:'));
    const measures = performance.getEntriesByType('measure').filter((m) => m.name.startsWith('Δ '));
    const measureByTarget = new Map(measures.map((m) => [m.name.slice(2), m.duration]));
    const table: BenchRow[] = marks.map((m) => ({
      delta_ms: (measureByTarget.get(m.name) ?? 0).toFixed(1),
      name: m.name,
      t_ms: m.startTime.toFixed(1),
    }));
    console.table(table);
    return { marks, measures, table };
  };
}
