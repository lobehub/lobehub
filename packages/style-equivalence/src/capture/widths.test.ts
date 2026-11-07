import { describe, expect, it } from 'vitest';

import { planWidths } from './widths';

describe('planWidths', () => {
  it('probes integer widths on both sides of a fractional boundary', () => {
    expect(planWidths(['(max-width: 479.98px)'], [1280]).widths).toEqual([400, 479, 480, 1280]);
  });

  it('probes the last matching and first non-matching width of each bound', () => {
    expect(planWidths(['(width < 600px)'], [1280]).widths).toEqual([460, 599, 600, 1280]);
    expect(planWidths(['(max-width: 600px)'], [1280]).widths).toEqual([460, 600, 601, 1280]);
    expect(planWidths(['(min-width: 600px)'], [1280]).widths).toEqual([460, 599, 600, 1280]);
  });
});
