import { describe, expect, it } from 'vitest';

import { analyzeSelector } from './selectorAnalysis';

describe('selector AST targeting', () => {
  it('keeps trigger and style target distinct for sibling/ancestor selectors', () => {
    const [plan] = analyzeSelector('.trigger:hover + .target::before');
    expect(plan).toMatchObject({
      gaps: [],
      pseudo: '::before',
      states: [{ selector: '.trigger', state: 'hover' }],
      targetSelector: '.trigger+.target',
    });
    expect(analyzeSelector('.parent:hover .child')[0].states[0].selector).toBe('.parent');
  });
  it('includes classes after the state in the trigger compound and preserves structural constraints', () => {
    const [plan] = analyzeSelector(
      '.row:hover.enabled:not([disabled]) > td[data-name="a,b"]::before',
    );
    expect(plan.gaps).toEqual([]);
    expect(plan.states[0].selector).toBe('.row.enabled:not([disabled])');
    expect(plan.targetSelector).toContain('[data-name="a,b"]');
  });
  it('retains multiple operation owners and individual selector-list branches', () => {
    const plans = analyzeSelector('.parent:hover .child:focus-visible, .other:active');
    expect(plans).toHaveLength(2);
    expect(plans[0].states.map((state) => state.selector)).toEqual(['.parent', '.parent .child']);
  });
  it.each([
    '.parent:has(.child:hover)',
    '.x:not(:hover)',
    '.x:is(.a:hover,.b)',
    '.x::selection',
    '&:hover',
  ])('does not silently simplify unsupported syntax: %s', (selector) => {
    expect(analyzeSelector(selector)[0].gaps.length).toBeGreaterThan(0);
  });
});
