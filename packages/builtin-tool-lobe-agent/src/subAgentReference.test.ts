import { describe, expect, it } from 'vitest';

import { appendSubAgentReference, stripSubAgentReference } from './subAgentReference';

describe('subAgentReference', () => {
  it('appends the sub-agent id after the result', () => {
    expect(appendSubAgentReference('Findings', 'thd_1')).toBe(
      'Findings\n\n<sub_agent id="thd_1" />',
    );
  });

  it('replaces an existing trailer instead of stacking another one', () => {
    const once = appendSubAgentReference('Findings', 'thd_1');

    expect(appendSubAgentReference(once, 'thd_1')).toBe(once);
  });

  it('keeps an empty result addressable', () => {
    expect(appendSubAgentReference('', 'thd_1')).toBe('<sub_agent id="thd_1" />');
  });

  it('strips only the trailing reference', () => {
    const content = 'See <sub_agent id="thd_0" /> inline\n\n<sub_agent id="thd_1" />';

    expect(stripSubAgentReference(content)).toBe('See <sub_agent id="thd_0" /> inline');
    expect(stripSubAgentReference('Plain result')).toBe('Plain result');
  });

  it('stays linear on long whitespace runs', () => {
    const content = `a${' '.repeat(50_000)}b`;
    const start = performance.now();

    expect(stripSubAgentReference(content)).toBe(content);
    expect(performance.now() - start).toBeLessThan(100);
  });
});
