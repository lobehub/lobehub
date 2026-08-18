import { chainVerifyJudge, VERIFY_JUDGE_PROMPT_VERSION } from '@lobechat/prompts';
import { describe, expect, it } from 'vitest';

describe('buildJudgePrompt evidence injection', () => {
  it('partitions traces with the current evidence-policy prompt version', () => {
    expect(VERIFY_JUDGE_PROMPT_VERSION).toBe('v2');
  });

  it('inlines text evidence and references stored artifacts under the criterion', () => {
    const { messages } = chainVerifyJudge({
      deliverable: 'done',
      goal: 'ship it',
      items: [
        {
          evidence: [
            { description: '首屏渲染', fileId: 'file-1', type: 'screenshot' },
            { content: '<div id="root">ok</div>', type: 'dom_snapshot' },
          ],
          id: 'item-1',
          title: 'Home renders',
        },
      ],
      mode: 'single',
    });

    expect(messages[1].content).toContain('Evidence captured during the run:');
    expect(messages[1].content).toContain(
      '(screenshot) — 首屏渲染 [artifact attached to this judge request]',
    );
    // inline text → quoted in full
    expect(messages[1].content).toContain('(dom_snapshot): <div id="root">ok</div>');
    expect(messages[0].content).toContain('Never treat mere existence');
  });

  it('omits the evidence block when an item has none', () => {
    const { messages } = chainVerifyJudge({
      deliverable: 'done',
      goal: 'ship it',
      items: [{ id: 'item-1', title: 'No evidence needed' }],
      mode: 'single',
    });

    expect(messages[1].content).not.toContain('Evidence captured during the run:');
  });
});
