import { describe, expect, it } from 'vitest';

import {
  type ClarificationQuestion,
  draftToClarificationAnswers,
  toAskUserArgs,
  toClarificationAnswers,
} from './answers';

const questions: ClarificationQuestion[] = [
  {
    description: 'Decides the tone',
    header: 'Q1',
    id: 'd1',
    options: [
      { id: 'option-1', label: 'End users' },
      { id: 'option-2', label: 'Developers' },
    ],
    question: 'Who reads it?',
  },
  {
    header: 'Q2',
    id: 'd2',
    options: [{ id: 'assume', label: 'Go with the assumption' }],
    question: 'Where is it published?',
  },
];

describe('toAskUserArgs', () => {
  it('keeps option ids and the question description for the form', () => {
    expect(toAskUserArgs(questions).questions[0]).toEqual({
      description: 'Decides the tone',
      header: 'Q1',
      options: questions[0].options,
      question: 'Who reads it?',
    });
  });
});

describe('toClarificationAnswers', () => {
  it('reads a picked option id as an option answer and typed text as a text answer', () => {
    expect(
      toClarificationAnswers(questions, {
        'Where is it published?': 'The changelog page',
        'Who reads it?': 'option-2',
      }),
    ).toEqual([
      { note: undefined, optionId: 'option-2', questionId: 'd1', type: 'option' },
      { questionId: 'd2', text: 'The changelog page', type: 'text' },
    ]);
  });

  it('attaches the notes box to option answers and appends it to typed ones', () => {
    expect(
      toClarificationAnswers(questions, {
        '__supplement__': 'SDK only',
        'Where is it published?': 'Changelog',
        'Who reads it?': 'option-2',
      }),
    ).toEqual([
      { note: 'SDK only', optionId: 'option-2', questionId: 'd1', type: 'option' },
      { questionId: 'd2', text: 'Changelog\nSDK only', type: 'text' },
    ]);
  });

  it('answers every question with the whole-form text', () => {
    expect(toClarificationAnswers(questions, { __freeform__: ' Developers, on GitHub ' })).toEqual([
      { questionId: 'd1', text: 'Developers, on GitHub', type: 'text' },
      { questionId: 'd2', text: 'Developers, on GitHub', type: 'text' },
    ]);
  });

  it('leaves out questions that were not answered', () => {
    expect(toClarificationAnswers(questions, { 'Who reads it?': 'option-1' })).toHaveLength(1);
  });
});

describe('questions worded the same', () => {
  const twins: ClarificationQuestion[] = [
    { header: '', id: 'a', options: [{ id: 'x', label: 'X' }], question: 'Which one?' },
    { header: '', id: 'b', options: [{ id: 'y', label: 'Y' }], question: 'Which one?' },
  ];

  it('keep separate answers instead of sharing one', () => {
    const texts = toAskUserArgs(twins).questions.map((q) => q.question);
    expect(new Set(texts).size).toBe(2);

    expect(toClarificationAnswers(twins, { [texts[0]]: 'x', [texts[1]]: 'y' })).toEqual([
      { note: undefined, optionId: 'x', questionId: 'a', type: 'option' },
      { note: undefined, optionId: 'y', questionId: 'b', type: 'option' },
    ]);
  });
});

describe('draftToClarificationAnswers', () => {
  it('reports what the draft would submit right now', () => {
    expect(
      draftToClarificationAnswers(questions, {
        custom: {},
        escapeActive: false,
        escapeText: '',
        picks: { 'Who reads it?': 'option-1' },
        supplementActive: false,
        supplementText: '',
      }),
    ).toEqual([{ note: undefined, optionId: 'option-1', questionId: 'd1', type: 'option' }]);
  });
});
