import { describe, expect, it } from 'vitest';

import { isAnsweredAskUserQuestion } from './isAnsweredAskUserQuestion';

describe('isAnsweredAskUserQuestion', () => {
  it('is true once the question has a submitted answer', () => {
    expect(
      isAnsweredAskUserQuestion(
        'askUserQuestion',
        {},
        {
          content: '',
          state: { askUserAnswers: { 'Who?': 'Owners' } },
        },
      ),
    ).toBe(true);
  });

  it('reads answers from legacy result content', () => {
    expect(
      isAnsweredAskUserQuestion(
        'askUserQuestion',
        {},
        { content: 'User submitted: {"Who?":"Owners"}' },
      ),
    ).toBe(true);
  });

  it('is false while the question is unanswered', () => {
    expect(isAnsweredAskUserQuestion('askUserQuestion', {}, undefined)).toBe(false);
  });

  it('leaves Claude Code permission requests alone', () => {
    expect(
      isAnsweredAskUserQuestion(
        'askUserQuestion',
        { claudeCodePermission: { kind: 'tool' } },
        { content: '', state: { askUserAnswers: { 'Edit?': 'allow-once' } } },
      ),
    ).toBe(false);
  });

  it('ignores other tools', () => {
    expect(
      isAnsweredAskUserQuestion('readFile', {}, { content: 'User submitted: {"a":"b"}' }),
    ).toBe(false);
  });
});
