import { describe, expect, it } from 'vitest';

import { buildBootMetricsPayload } from './buildPayload';

const baseDimensions = {
  appVersion: '1.0.0',
  cold: true,
  isLogin: false,
  platform: 'web' as const,
};

const emptySnapshot = { marks: {}, spans: [] };

describe('buildBootMetricsPayload', () => {
  describe('totalMs', () => {
    it('uses first-paint mark when present', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        snapshot: { marks: { 'first-paint': 420 }, spans: [] },
      });
      expect(result.totalMs).toBe(420);
    });

    it('falls back to max span end when first-paint is absent', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        snapshot: {
          marks: {},
          spans: [
            { durMs: 100, name: 'a', startMs: 50 },
            { durMs: 200, name: 'b', startMs: 0 },
          ],
        },
      });
      expect(result.totalMs).toBe(200);
    });

    it('returns 0 when no marks and no spans', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        snapshot: emptySnapshot,
      });
      expect(result.totalMs).toBe(0);
    });
  });

  describe('rounding (integer ms columns)', () => {
    it('rounds totalMs and span startMs/durMs to integers', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        snapshot: {
          marks: { 'first-paint': 1746.4000000059605 },
          spans: [{ durMs: 1415.2, name: 'bundle', startMs: 46.7000000029 }],
        },
      });
      expect(result.totalMs).toBe(1746);
      expect(result.spans[0]).toEqual({ durMs: 1415, name: 'bundle', startMs: 47 });
    });

    it('rounds derived spans (ttfb/fcp) to integers', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        fcpMs: 900.5,
        navResponseStartMs: 23.9,
        snapshot: { marks: { 'first-paint': 1000 }, spans: [] },
      });
      const byName = Object.fromEntries(result.spans.map((s) => [s.name, s]));
      expect(byName.ttfb.durMs).toBe(24);
      expect(byName.fcp.durMs).toBe(901);
    });
  });

  describe('dimensions pass-through', () => {
    it('propagates all dimension fields', () => {
      const result = buildBootMetricsPayload({
        dimensions: {
          anonId: 'a123',
          appVersion: '2.0.0',
          cold: false,
          isLogin: true,
          platform: 'desktop',
          userId: 'u42',
        },
        snapshot: emptySnapshot,
      });
      expect(result.appVersion).toBe('2.0.0');
      expect(result.platform).toBe('desktop');
      expect(result.isLogin).toBe(true);
      expect(result.cold).toBe(false);
      expect(result.userId).toBe('u42');
      expect(result.anonId).toBe('a123');
    });
  });

  describe('snapshot spans', () => {
    it('includes existing snapshot spans unchanged', () => {
      const span = { durMs: 10, name: 'core-init', startMs: 5 };
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        snapshot: { marks: {}, spans: [span] },
      });
      expect(result.spans).toContainEqual(span);
    });
  });

  describe('ttfb derived span', () => {
    it('adds ttfb when navResponseStartMs is provided', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        navResponseStartMs: 80,
        snapshot: emptySnapshot,
      });
      expect(result.spans).toContainEqual({ durMs: 80, name: 'ttfb', startMs: 0 });
    });

    it('omits ttfb when navResponseStartMs is absent', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        snapshot: emptySnapshot,
      });
      expect(result.spans.find((s) => s.name === 'ttfb')).toBeUndefined();
    });

    it('omits ttfb when durMs is negative', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        navResponseStartMs: -5,
        snapshot: emptySnapshot,
      });
      expect(result.spans.find((s) => s.name === 'ttfb')).toBeUndefined();
    });
  });

  describe('doc derived span', () => {
    it('adds doc when htmlMarkMs is provided', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        htmlMarkMs: 300,
        snapshot: emptySnapshot,
      });
      expect(result.spans).toContainEqual({ durMs: 300, name: 'doc', startMs: 0 });
    });

    it('omits doc when htmlMarkMs is absent', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        snapshot: emptySnapshot,
      });
      expect(result.spans.find((s) => s.name === 'doc')).toBeUndefined();
    });
  });

  describe('bundle derived span', () => {
    it('adds bundle when both htmlMarkMs and bundle-eval mark are present', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        htmlMarkMs: 200,
        snapshot: { marks: { 'bundle-eval': 350 }, spans: [] },
      });
      expect(result.spans).toContainEqual({ durMs: 150, name: 'bundle', startMs: 200 });
    });

    it('omits bundle when htmlMarkMs is absent', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        snapshot: { marks: { 'bundle-eval': 350 }, spans: [] },
      });
      expect(result.spans.find((s) => s.name === 'bundle')).toBeUndefined();
    });

    it('omits bundle when bundle-eval mark is absent', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        htmlMarkMs: 200,
        snapshot: emptySnapshot,
      });
      expect(result.spans.find((s) => s.name === 'bundle')).toBeUndefined();
    });

    it('omits bundle when duration is negative (htmlMarkMs > bundle-eval)', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        htmlMarkMs: 400,
        snapshot: { marks: { 'bundle-eval': 300 }, spans: [] },
      });
      expect(result.spans.find((s) => s.name === 'bundle')).toBeUndefined();
    });
  });

  describe('store-gate derived span', () => {
    it('adds store-gate from app-ready to first-paint marks', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        snapshot: { marks: { 'app-ready': 500, 'first-paint': 650 }, spans: [] },
      });
      expect(result.spans).toContainEqual({ durMs: 150, name: 'store-gate', startMs: 500 });
    });

    it('omits store-gate when app-ready mark is absent', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        snapshot: { marks: { 'first-paint': 650 }, spans: [] },
      });
      expect(result.spans.find((s) => s.name === 'store-gate')).toBeUndefined();
    });

    it('omits store-gate when first-paint mark is absent', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        snapshot: { marks: { 'app-ready': 500 }, spans: [] },
      });
      expect(result.spans.find((s) => s.name === 'store-gate')).toBeUndefined();
    });

    it('omits store-gate when duration is negative', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        snapshot: { marks: { 'app-ready': 700, 'first-paint': 600 }, spans: [] },
      });
      expect(result.spans.find((s) => s.name === 'store-gate')).toBeUndefined();
    });
  });

  describe('fcp derived span', () => {
    it('adds fcp when fcpMs is provided', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        fcpMs: 550,
        snapshot: emptySnapshot,
      });
      expect(result.spans).toContainEqual({ durMs: 550, name: 'fcp', startMs: 0 });
    });

    it('omits fcp when fcpMs is absent', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        snapshot: emptySnapshot,
      });
      expect(result.spans.find((s) => s.name === 'fcp')).toBeUndefined();
    });

    it('omits fcp when fcpMs is negative', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        fcpMs: -1,
        snapshot: emptySnapshot,
      });
      expect(result.spans.find((s) => s.name === 'fcp')).toBeUndefined();
    });
  });

  describe('resourceTimings', () => {
    it('appends resource timings verbatim', () => {
      const rt = { durMs: 120, name: 'fetch:server-config', startMs: 10 };
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        resourceTimings: [rt],
        snapshot: emptySnapshot,
      });
      expect(result.spans).toContainEqual(rt);
    });

    it('drops resource timing with negative duration', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        resourceTimings: [{ durMs: -5, name: 'fetch:user-state', startMs: 10 }],
        snapshot: emptySnapshot,
      });
      expect(result.spans.find((s) => s.name === 'fetch:user-state')).toBeUndefined();
    });

    it('does not duplicate a span name already in snapshot', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        resourceTimings: [{ durMs: 50, name: 'cache-hydration', startMs: 0 }],
        snapshot: {
          marks: {},
          spans: [{ durMs: 30, name: 'cache-hydration', startMs: 5 }],
        },
      });
      expect(result.spans.filter((s) => s.name === 'cache-hydration')).toHaveLength(1);
    });
  });

  describe('no-duplicate protection', () => {
    it('does not emit derived ttfb if name already in snapshot', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        navResponseStartMs: 80,
        snapshot: {
          marks: {},
          spans: [{ durMs: 60, name: 'ttfb', startMs: 0 }],
        },
      });
      expect(result.spans.filter((s) => s.name === 'ttfb')).toHaveLength(1);
    });
  });

  describe('spans cap', () => {
    it('truncates spans to 64 when input would produce more', () => {
      const manySpans = Array.from({ length: 70 }, (_, i) => ({
        durMs: 1,
        name: `span-${i}`,
        startMs: i,
      }));
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        snapshot: { marks: {}, spans: manySpans },
      });
      expect(result.spans).toHaveLength(64);
    });

    it('does not truncate spans when count is exactly 64', () => {
      const spans = Array.from({ length: 64 }, (_, i) => ({
        durMs: 1,
        name: `span-${i}`,
        startMs: i,
      }));
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        snapshot: { marks: {}, spans },
      });
      expect(result.spans).toHaveLength(64);
    });
  });

  describe('non-finite duration guard', () => {
    it('omits span with NaN duration', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        navResponseStartMs: Number.NaN,
        snapshot: emptySnapshot,
      });
      expect(result.spans.find((s) => s.name === 'ttfb')).toBeUndefined();
    });

    it('omits span with Infinity duration', () => {
      const result = buildBootMetricsPayload({
        dimensions: baseDimensions,
        navResponseStartMs: Number.POSITIVE_INFINITY,
        snapshot: emptySnapshot,
      });
      expect(result.spans.find((s) => s.name === 'ttfb')).toBeUndefined();
    });
  });
});
