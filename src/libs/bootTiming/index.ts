export interface BootSpan {
  durMs: number;
  name: string;
  startMs: number;
}

export interface BootIdleOptions {
  /** Required quiet window after the last asynchronous span finishes. */
  idleMs?: number;
  /** Upper bound for telemetry finalization; this never blocks application rendering. */
  timeoutMs?: number;
}

const now = (): number => (typeof performance === 'undefined' ? 0 : performance.now());

let spans: BootSpan[] = [];
let marks: Record<string, number> = {};
let pendingAsyncSpans = 0;
const activityListeners = new Set<() => void>();

const emitActivity = (): void => {
  for (const listener of activityListeners) listener();
};

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
    pendingAsyncSpans += 1;
    emitActivity();
    try {
      return await fn();
    } finally {
      spans.push({ durMs: now() - start, name, startMs: start });
      pendingAsyncSpans = Math.max(0, pendingAsyncSpans - 1);
      emitActivity();
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

  waitForIdle(options: BootIdleOptions = {}): Promise<void> {
    const idleMs = Math.max(0, options.idleMs ?? 0);
    const timeoutMs = Math.max(0, options.timeoutMs ?? 8000);

    return new Promise((resolve) => {
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        if (idleTimer !== undefined) clearTimeout(idleTimer);
        clearTimeout(timeoutTimer);
        activityListeners.delete(scheduleIdleCheck);
        resolve();
      };

      const scheduleIdleCheck = () => {
        if (idleTimer !== undefined) clearTimeout(idleTimer);
        idleTimer = undefined;
        if (pendingAsyncSpans > 0) return;
        idleTimer = setTimeout(finish, idleMs);
      };

      activityListeners.add(scheduleIdleCheck);
      const timeoutTimer = setTimeout(finish, timeoutMs);
      scheduleIdleCheck();
    });
  },

  _reset(): void {
    spans = [];
    marks = {};
    pendingAsyncSpans = 0;
    emitActivity();
  },
};
