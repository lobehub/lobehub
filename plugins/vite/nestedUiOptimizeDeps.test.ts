import { describe, expect, it } from 'vitest';

import { nestedUiOptimizeDeps } from './nestedUiOptimizeDeps';

describe('nestedUiOptimizeDeps', () => {
  it('pre-bundles the CJK markdown serializer away from the pinned mdast-util-to-markdown', () => {
    // Served raw, remark-cjk-friendly's bare `mdast-util-to-markdown` import is rewritten to the
    // optimized 2.1.2 the workspace pins, which has no attention handler: every emphasis then
    // throws "Expected a handler with the attention API" and the page fails to render. Dropping
    // this entry brings the crash back in dev.
    expect(nestedUiOptimizeDeps).toContain('@lobehub/ui > remark-cjk-friendly');
  });

  it('lists nested @lobehub/ui dependencies only, once each', () => {
    expect(new Set(nestedUiOptimizeDeps).size).toBe(nestedUiOptimizeDeps.length);

    for (const dependency of nestedUiOptimizeDeps) {
      expect(dependency.startsWith('@lobehub/ui > ')).toBe(true);
    }
  });
});
