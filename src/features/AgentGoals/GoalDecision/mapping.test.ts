import {
  GOAL_CLARIFICATION_TITLE,
  GOAL_MACHINE_GATE_TITLE,
  GOAL_MANAGER_QUESTION_TITLE,
} from '@lobechat/const/goal';
import { describe, expect, it } from 'vitest';

import { goalGateCategory, toGateAnswer, toGateQuestion } from './mapping';

const recover = [
  { id: 'retry', label: 'Retry task' },
  { id: 'retire', label: 'Retire task' },
];

describe('goalGateCategory', () => {
  it('tells a system problem apart from a judgment call', () => {
    expect(goalGateCategory({ nodeTitle: GOAL_MACHINE_GATE_TITLE, options: recover })).toBe(
      'machine',
    );
    expect(
      goalGateCategory({ nodeTitle: 'Choose how to recover failed task', options: recover }),
    ).toBe('judgment');
  });

  it('recognizes the goal acceptance and clarification gates', () => {
    expect(goalGateCategory({ options: [...recover, { id: 'fail', label: 'Fail goal' }] })).toBe(
      'goalAcceptance',
    );
    expect(goalGateCategory({ nodeTitle: GOAL_CLARIFICATION_TITLE })).toBe('clarify');
  });

  it("reads the main Agent's own answers as its question, on either gate", () => {
    expect(goalGateCategory({ nodeTitle: GOAL_MANAGER_QUESTION_TITLE, options: [] })).toBe(
      'agentQuestion',
    );
    // A takeover question rides the failed Task's gate under the coordinator title.
    expect(
      goalGateCategory({
        nodeTitle: 'Choose how to recover failed task',
        options: [
          { effect: 'retry', id: 'waive', label: 'Waive it' },
          { effect: 'retire', id: 'keep', label: 'Keep it' },
        ],
      }),
    ).toBe('agentQuestion');
  });
});

describe('toGateQuestion', () => {
  it('writes each answer with what it does and marks the advised one', () => {
    const question = toGateQuestion(
      { id: 'd1', options: recover, question: 'Q', recommendedOptionId: 'retry' },
      {
        basis: 'Main Agent: the fixture is stale',
        describe: (option) => (option.id === 'retry' ? 'Send it back' : undefined),
        label: (option) => option.label.toUpperCase(),
        question: 'The attempt budget is used up',
      },
    );

    expect(question).toEqual({
      description: 'Main Agent: the fixture is stale',
      header: '',
      id: 'd1',
      options: [
        { description: 'Send it back', id: 'retry', label: 'RETRY TASK', recommended: true },
        { id: 'retire', label: 'RETIRE TASK' },
      ],
      question: 'The attempt budget is used up',
    });
  });

  it("keeps an Agent's own consequence over the generic one", () => {
    const question = toGateQuestion(
      {
        id: 'd2',
        options: [{ description: 'PR order follows merge time', id: 'waive', label: 'Waive' }],
        question: 'Waive?',
      },
      { describe: () => 'generic', label: (o) => o.label, question: 'Waive?' },
    );
    expect(question.options[0].description).toBe('PR order follows merge time');
  });
});

describe('toGateAnswer', () => {
  const decision = { id: 'd1', options: recover, question: 'Q', recommendedOptionId: 'retire' };

  it('passes a picked option and its note through', () => {
    expect(
      toGateAnswer(decision, [
        { note: 'use staging', optionId: 'retire', questionId: 'd1', type: 'option' },
      ]),
    ).toEqual({ optionId: 'retire', resolution: 'use staging' });
  });

  it('turns written-out guidance into a retry that carries it', () => {
    expect(
      toGateAnswer(decision, [{ questionId: 'd1', text: 'Try the v2 API', type: 'text' }]),
    ).toEqual({ optionId: 'retry', resolution: 'Try the v2 API' });
  });

  it('falls back to the advised answer when nothing retries', () => {
    expect(
      toGateAnswer(
        {
          id: 'd2',
          options: [
            { id: 'desktop', label: 'Desktop' },
            { id: 'all', label: 'All' },
          ],
          question: 'Scope?',
          recommendedOptionId: 'all',
        },
        [{ questionId: 'd2', text: 'Both, desktop first', type: 'text' }],
      ),
    ).toEqual({ optionId: 'all', resolution: 'Both, desktop first' });
  });
});
