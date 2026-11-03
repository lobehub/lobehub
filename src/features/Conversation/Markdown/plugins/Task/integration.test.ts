import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';

import { remarkTaskBlock } from './remarkTaskBlock';

const runRemark = (markdown: string) => {
  const processor = unified().use(remarkParse).use(remarkTaskBlock);
  const tree = processor.parse(markdown);
  return processor.runSync(tree);
};

describe('task remark integration', () => {
  it('handles a leading user_feedback block before <task>', () => {
    const markdown = `<user_feedback>
<comment id="c1" time="1m ago">looks good</comment>
</user_feedback>

<task>
T-1 demo
Status: ⭕ backlog     Priority: -
Instruction: do it.

Review: (not configured)
</task>`;

    const tree: any = runRemark(markdown);
    const taskNodes = (tree.children as any[]).filter((c) => c.type === 'taskBlock');
    expect(taskNodes).toHaveLength(1);
    const value = taskNodes[0].data.hChildren[0].value as string;
    expect(value).toContain('T-1 demo');
    expect(value).toContain('Review: (not configured)');
  });

  it('does not crash when no <task> tag present', () => {
    const markdown = `Just a plain message without task xml.`;
    const tree: any = runRemark(markdown);
    const taskNodes = (tree.children as any[]).filter((c) => c.type === 'taskBlock');
    expect(taskNodes).toHaveLength(0);
  });

  it('captures the entire <task> block content as a single text child', () => {
    const markdown = `<task>
<hint>This tag contains the complete task context. Do NOT call viewTask to re-fetch it.</hint>
T-32 写一本《AI Agent 实战指南》
Status: ⭕ backlog     Priority: -
Instruction: 帮我写一本面向开发者的 AI Agent 技术书籍。

Review: (not configured)
</task>`;

    const tree: any = runRemark(markdown);

    const taskNodes = (tree.children as any[]).filter((c) => c.type === 'taskBlock');
    expect(taskNodes).toHaveLength(1);

    const value = taskNodes[0].data.hChildren[0].value as string;
    expect(value).toContain('T-32');
    expect(value).toContain('写一本《AI Agent 实战指南》');
    expect(value).toContain('Status:');
    expect(value).toContain('Instruction:');
    expect(value).toContain('Review: (not configured)');
  });
});
