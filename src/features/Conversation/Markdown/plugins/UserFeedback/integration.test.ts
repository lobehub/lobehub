import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';

import { USER_FEEDBACK_TAG } from '@/const/plugin';

import { remarkTaskBlock } from '../Task/remarkTaskBlock';
import { remarkUserFeedbackBlock } from './remarkUserFeedbackBlock';

const runRemark = (markdown: string) => {
  const processor = unified().use(remarkParse).use(remarkUserFeedbackBlock).use(remarkTaskBlock);
  const tree = processor.parse(markdown);
  return processor.runSync(tree);
};

describe('user_feedback remark integration', () => {
  it('captures a user_feedback block sitting next to a <task> block', () => {
    const markdown = `<user_feedback>
<comment id="cmt_1" time="9d ago">你能否写成文档而不是写在最后一个输出里？ </comment>
<comment id="cmt_2" time="9d ago">不是写到linear 里，而是写 agent Document 里面</comment>
</user_feedback>

<task>
T-31 总结下我前一天在 linear 上的工作情况
Status: ⏰ scheduled     Priority: -
Instruction: 总结下我前一天在 linear 上的工作情况。以文档形式产出内容

Review: (not configured)
</task>`;

    const tree: any = runRemark(markdown);
    const feedbackNodes = (tree.children as any[]).filter(
      (c) => c.type === `${USER_FEEDBACK_TAG}Block`,
    );
    const taskNodes = (tree.children as any[]).filter((c) => c.type === 'taskBlock');

    expect(feedbackNodes).toHaveLength(1);
    expect(taskNodes).toHaveLength(1);

    const feedbackInner = feedbackNodes[0].data.hChildren[0].value as string;
    expect(feedbackInner).toContain('<comment id="cmt_1"');
    expect(feedbackInner).toContain('你能否写成文档而不是写在最后一个输出里？');
    expect(feedbackInner).toContain('不是写到linear 里，而是写 agent Document 里面');

    const taskInner = taskNodes[0].data.hChildren[0].value as string;
    expect(taskInner).toContain('T-31');
    expect(taskInner).toContain('Review: (not configured)');
  });

  it('captures a simple user_feedback block', () => {
    const markdown = `<user_feedback>
<comment time="1m ago">looks good</comment>
</user_feedback>`;
    const tree: any = runRemark(markdown);
    const feedbackNodes = (tree.children as any[]).filter(
      (c) => c.type === `${USER_FEEDBACK_TAG}Block`,
    );
    expect(feedbackNodes).toHaveLength(1);
    expect(feedbackNodes[0].data.hChildren[0].value).toContain('looks good');
  });

  it('does not match when only the opening tag is present', () => {
    const markdown = `<user_feedback>
<comment time="1m ago">orphan</comment>`;
    const tree: any = runRemark(markdown);
    const feedbackNodes = (tree.children as any[]).filter(
      (c) => c.type === `${USER_FEEDBACK_TAG}Block`,
    );
    expect(feedbackNodes).toHaveLength(0);
  });

  it('leaves unrelated markdown untouched', () => {
    const markdown = `Just a normal paragraph without any tag.`;
    const tree: any = runRemark(markdown);
    const feedbackNodes = (tree.children as any[]).filter(
      (c) => c.type === `${USER_FEEDBACK_TAG}Block`,
    );
    expect(feedbackNodes).toHaveLength(0);
  });
});
