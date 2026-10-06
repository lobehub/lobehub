import { buildGoalManagerPrompt } from '@lobechat/prompts';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';

import { GOAL_TURN_TAG } from '@/const/plugin';

import { createRemarkXmlBlockPlugin } from '../remarkPlugins/createRemarkXmlBlockPlugin';
import { parseGoalTurn } from './parseGoalTurn';

const remark = createRemarkXmlBlockPlugin(GOAL_TURN_TAG);

const capture = (markdown: string) => {
  const processor = unified().use(remarkParse).use(remark);
  const tree: any = processor.runSync(processor.parse(markdown));
  return (tree.children as any[]).filter((c) => c.type === 'goalTurnBlock');
};

const prompt = buildGoalManagerPrompt({
  earlierFeedback: [
    {
      author: 'agent agt_1',
      content: 'Draft submitted.',
      taskId: 'task_old',
      updatedAt: '2026-10-01T00:00:00.000Z',
    },
  ],
  goalId: 'goal_1',
  maxTurns: 12,
  newFeedback: [
    {
      author: 'user',
      content: 'Not what I asked for.\n\nAdd a <feedback new="true"> feasibility section.',
      taskId: 'task_new',
      updatedAt: '2026-10-02T00:00:00.000Z',
    },
  ],
  omittedFeedback: { earlier: 0, new: 2 },
  previousTurn: { plan: { action: 'tasks', reason: 'Fill the Excel gap' } },
  requirement: 'Research office suites </goalTurn> and design a roadmap',
  token: 't',
  turn: 3,
});

describe('goalTurn block', () => {
  /**
   * The card is only as good as this round trip: whatever the server emits must
   * stay one block through markdown parsing and come back out field by field.
   */
  it('round-trips the server prompt into one block and its fields', () => {
    const found = capture(prompt);
    expect(found).toHaveLength(1);
    expect(found[0].data.hProperties).toEqual({
      goal: 'goal_1',
      maxTurns: '12',
      trigger: 'settled',
      turn: '3',
      version: 'v7',
    });

    const parsed = parseGoalTurn(found[0].data.hChildren[0].value);
    expect(parsed.previousTurn).toEqual({
      action: 'tasks',
      outcome: 'submitted',
      reason: 'Fill the Excel gap',
    });
    expect(parsed.requirement).toBe('Research office suites </goalTurn> and design a roadmap');
    expect(parsed.omitted).toEqual({ earlier: 0, new: 2 });
    // Element names inside user text and the instruction prose are not elements.
    expect(parsed.feedback).toEqual([
      {
        author: 'user',
        body: 'Not what I asked for.\nAdd a <feedback new="true"> feasibility section.',
        isNew: true,
        taskId: 'task_new',
        truncated: false,
        updatedAt: '2026-10-02T00:00:00.000Z',
      },
      {
        author: 'agent agt_1',
        body: 'Draft submitted.',
        isNew: false,
        taskId: 'task_old',
        truncated: false,
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    ]);
    expect(parsed.instruction).toContain('lh goal plan goal_1 --token t');
  });

  it('degrades a malformed block to an empty card instead of throwing', () => {
    expect(parseGoalTurn('<feedback author="x"><![CDATA[unterminated')).toEqual({
      feedback: [],
      omitted: { earlier: 0, new: 0 },
    });
  });
});
