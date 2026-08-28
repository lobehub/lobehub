import { describe, expect, it } from 'vitest';

import { promptExpertise } from './expertise';

const domain = {
  canonEntries: [
    {
      key: 'JTBD',
      source: 'Jobs to Be Done',
      statement: 'Start from the user task.',
      title: 'User task',
    },
  ],
  domainFilter: ' Product   decisions ',
  flow: ['Define the task', 'Verify the outcome'],
  lessons: [
    {
      code: 'P-01',
      layer: 'L1',
      polarity: 'bad' as const,
      sections: [
        { body: 'Start from features.', key: 'wrong' as const },
        { body: 'Define the user task first.', key: 'correct' as const },
      ],
      title: 'Feature accumulation is not value',
    },
  ],
  outOfScope: 'Pure visual preference',
  slug: 'product-design',
  title: 'Product "Design"',
};

describe('promptExpertise', () => {
  it('uses expertise and domain boundaries with compact Markdown content', () => {
    const content = promptExpertise([domain]);

    expect(content).toContain('<domain id="product-design" name="Product &quot;Design&quot;">');
    expect(content).toContain('Scope: Product decisions');
    expect(content).toContain('- JTBD · User task: Start from the user task. (Jobs to Be Done)');
    expect(content).toContain('1. Define the task\n2. Verify the outcome');
    expect(content).toContain('### P-01 · BAD · L1 — Feature accumulation is not value');
    expect(content).toContain('Wrong: Start from features.');
    expect(content).toMatch(/^<expertise>[\s\S]*<\/expertise>$/);
  });

  it('omits empty optional sections', () => {
    const content = promptExpertise([
      { ...domain, canonEntries: [], flow: [], lessons: [], outOfScope: null },
    ]);

    expect(content).not.toContain('## Canon');
    expect(content).not.toContain('## Workflow');
    expect(content).not.toContain('## Lessons');
    expect(content).not.toContain('Excludes:');
  });

  it('escapes content that could break expertise boundaries', () => {
    const content = promptExpertise([
      { ...domain, domainFilter: 'Use <domain> & never close </expertise>' },
    ]);

    expect(content).toContain('Scope: Use &lt;domain&gt; &amp; never close &lt;/expertise&gt;');
    expect(content.match(/<\/expertise>/g)).toHaveLength(1);
  });
});
