import { describe, expect, it } from 'vitest';

import { buildJudgePrompt } from '../prompts';

describe('buildJudgePrompt evidence injection', () => {
  it('inlines text evidence and references stored artifacts under the criterion', () => {
    const { system, user } = buildJudgePrompt({
      deliverable: 'done',
      goal: 'ship it',
      items: [
        {
          evidence: [
            { description: '首屏渲染', type: 'screenshot' },
            { content: '<div id="root">ok</div>', type: 'dom_snapshot' },
          ],
          id: 'item-1',
          title: 'Home renders',
        },
      ],
      mode: 'single',
    });

    expect(user).toContain('Evidence captured during the run:');
    // stored artifact → referenced by presence + caption, not inlined
    expect(user).toContain('(screenshot) — 首屏渲染 [artifact captured]');
    // inline text → quoted in full
    expect(user).toContain('(dom_snapshot): <div id="root">ok</div>');
    // the judge is told to weight artifacts as primary Data
    expect(system).toContain('primary Data');
  });

  it('omits the evidence block when an item has none', () => {
    const { user } = buildJudgePrompt({
      deliverable: 'done',
      goal: 'ship it',
      items: [{ id: 'item-1', title: 'No evidence needed' }],
      mode: 'single',
    });

    expect(user).not.toContain('Evidence captured during the run:');
  });
});
