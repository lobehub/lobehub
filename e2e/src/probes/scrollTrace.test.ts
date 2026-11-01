import { describe, expect, it } from 'vitest';

import { classifyScrollTrace } from './scrollTrace';

describe('classifyScrollTrace', () => {
  it('reports a multi-frame monotonic descent as a slide', () => {
    const samples = [0, 0, 6, 17, 27, 51, 67, 148, 236, 314, 449, 600, 600, 600];

    expect(classifyScrollTrace(samples).motion).toBe('slide');
  });

  it('reports a single-frame landing as a jump', () => {
    const samples = [0, 0, 0, 600, 600, 600];

    expect(classifyScrollTrace(samples).motion).toBe('jump');
  });

  it('reports a clamped stub followed by an instant landing as a jump', () => {
    const samples = [0, 3, 8, 12, 12, 600, 600];

    expect(classifyScrollTrace(samples).motion).toBe('jump');
  });

  it('reports no movement as none', () => {
    expect(classifyScrollTrace([120, 120, 120]).motion).toBe('none');
  });
});
