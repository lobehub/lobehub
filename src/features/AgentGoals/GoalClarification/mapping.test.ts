import { describe, expect, it } from 'vitest';

import {
  assumeAll,
  type PendingGoalClarification,
  toClarificationQuestions,
  toDecisionAnswers,
} from './mapping';

const pending: PendingGoalClarification[] = [
  {
    decisionId: 'd1',
    description: 'Decides the tone',
    options: [
      { id: 'option-1', label: '终端用户' },
      { id: 'option-2', label: '开发者' },
      { description: '面向终端用户', id: 'assume', label: 'Go with the assumption' },
      { id: 'answer', label: 'Answer with my note' },
    ],
    question: '给谁看？',
  },
];

describe('toClarificationQuestions', () => {
  it('drops the note option, which the form’s own text row replaces, and localizes the assumption', () => {
    expect(toClarificationQuestions(pending, { assume: '按 Agent 的假设来' })).toEqual([
      {
        description: 'Decides the tone',
        header: '',
        id: 'd1',
        options: [
          { description: undefined, id: 'option-1', label: '终端用户' },
          { description: undefined, id: 'option-2', label: '开发者' },
          { description: '面向终端用户', id: 'assume', label: '按 Agent 的假设来' },
        ],
        question: '给谁看？',
      },
    ]);
  });
});

describe('toDecisionAnswers', () => {
  it('sends a picked option as itself and typed text as the note answer', () => {
    expect(
      toDecisionAnswers([
        { note: '只关心 SDK', optionId: 'option-2', questionId: 'd1', type: 'option' },
        { questionId: 'd2', text: '发在 GitHub Release', type: 'text' },
      ]),
    ).toEqual([
      { decisionId: 'd1', optionId: 'option-2', resolution: '只关心 SDK' },
      { decisionId: 'd2', optionId: 'answer', resolution: '发在 GitHub Release' },
    ]);
  });
});

describe('assumeAll', () => {
  it('lets the agent proceed on its assumption for every question', () => {
    expect(assumeAll(pending)).toEqual([{ decisionId: 'd1', optionId: 'assume' }]);
  });
});
