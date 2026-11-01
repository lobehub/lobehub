import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';

import { remarkScmEventBlock } from './remarkScmEventBlock';

const runRemark = (markdown: string) => {
  const processor = unified().use(remarkParse).use(remarkScmEventBlock);
  const tree = processor.parse(markdown);
  return processor.runSync(tree);
};

const blocks = (tree: any) => (tree.children as any[]).filter((c) => c.type === 'scmEventBlock');

describe('scmEvent remark integration', () => {
  it('captures the server-shaped block verbatim, with the open tag attributes as properties', () => {
    const markdown = `<scmEvent branch="feat/x" kind="ci_failed" number="7" provider="github" repo="o/r" sha="abcdef0" url="https://github.com/o/r/pull/7">
<check conclusion="failure" name="Test" url="https://github.com/o/r/actions/runs/9/job/2">
<log><![CDATA[
FAIL src/a.test.ts
  expected 1
]]></log>
</check>
<instruction>
Investigate the failure and fix it.
</instruction>
</scmEvent>`;

    const tree: any = runRemark(markdown);
    const found = blocks(tree);
    expect(found).toHaveLength(1);
    expect(found[0].data.hProperties).toEqual({
      branch: 'feat/x',
      kind: 'ci_failed',
      number: '7',
      provider: 'github',
      repo: 'o/r',
      sha: 'abcdef0',
      url: 'https://github.com/o/r/pull/7',
    });
    const inner = found[0].data.hChildren[0].value as string;
    expect(inner).toContain('<log><![CDATA[\nFAIL src/a.test.ts\n  expected 1\n]]></log>');
    expect(inner).toContain('<instruction>\nInvestigate the failure and fix it.\n</instruction>');
  });

  it('still finds the closing tag when a blank line split the block', () => {
    const markdown = `<scmEvent kind="review_commented" provider="github" repo="o/r">
<review author="codex"><![CDATA[
first
]]></review>

<instruction>
Address it.
</instruction>
</scmEvent>

Trailing paragraph.`;

    const tree: any = runRemark(markdown);
    const found = blocks(tree);
    expect(found).toHaveLength(1);
    const inner = found[0].data.hChildren[0].value as string;
    expect(inner).toContain('<review author="codex">');
    expect(inner).toContain('Address it.');
    expect(tree.children.at(-1).type).toBe('paragraph');
  });

  it('leaves messages without the tag alone', () => {
    const tree: any = runRemark('Plain user text with <b>html</b>.');
    expect(blocks(tree)).toHaveLength(0);
  });
});
