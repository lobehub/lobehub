export interface BootSpan {
  durMs: number;
  name: string;
  startMs: number;
}

const now = (): number => (typeof performance === 'undefined' ? 0 : performance.now());

let spans: BootSpan[] = [];
let marks: Record<string, number> = {};

export const bootTiming = {
  mark(name: string): void {
    try {
      marks[name] = now();
    } catch (_) {
      void _;
    }
  },

  measure(name: string, fromMark: string, toMark: string): void {
    try {
      if (!(fromMark in marks) || !(toMark in marks)) return;
      spans.push({ durMs: marks[toMark] - marks[fromMark], name, startMs: marks[fromMark] });
    } catch (_) {
      void _;
    }
  },

  recordSpan(name: string, startMs: number, durMs: number): void {
    try {
      spans.push({ durMs, name, startMs });
    } catch (_) {
      void _;
    }
  },

  snapshot(): { marks: Record<string, number>; spans: BootSpan[] } {
    try {
      return { marks: { ...marks }, spans: [...spans] };
    } catch (_) {
      void _;
      return { marks: {}, spans: [] };
    }
  },

  async span<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
    const start = now();
    try {
      return await fn();
    } finally {
      spans.push({ durMs: now() - start, name, startMs: start });
    }
  },

  spanSync<T>(name: string, fn: () => T): T {
    const start = now();
    try {
      return fn();
    } finally {
      spans.push({ durMs: now() - start, name, startMs: start });
    }
  },

  _reset(): void {
    spans = [];
    marks = {};
  },
};
