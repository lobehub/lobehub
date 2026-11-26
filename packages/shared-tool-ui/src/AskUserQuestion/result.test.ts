import { describe, expect, it } from 'vitest';

import { resolveAskUserAnswers, summarizeAskUserAnswers } from './result';
import type { AskUserQuestionItem } from './types';

describe('resolveAskUserAnswers', () => {
  it('prefers the structured answers persisted in plugin state', () => {
    expect(
      resolveAskUserAnswers(
        {
          askUserAnswers: {
            Scope: ['Chat', 'Settings'],
            __supplement__: 'Keep the existing behavior.',
          },
        },
        'User submitted: {"Scope":"Legacy"}',
      ),
    ).toEqual({
      Scope: ['Chat', 'Settings'],
      __supplement__: 'Keep the existing behavior.',
    });
  });

  it('recovers answers from legacy builtin tool result content', () => {
    expect(
      resolveAskUserAnswers(
        undefined,
        'User submitted: {"Which direction?":"Visual polish","Surfaces":["Chat","Settings"],"__supplement__":"Keep the existing behavior."}',
      ),
    ).toEqual({
      'Which direction?': 'Visual polish',
      'Surfaces': ['Chat', 'Settings'],
      '__supplement__': 'Keep the existing behavior.',
    });
  });

  it('ignores malformed or unsupported answer payloads', () => {
    expect(resolveAskUserAnswers(undefined, 'User submitted: not-json')).toBeUndefined();
    expect(resolveAskUserAnswers(undefined, 'Question(s) presented to the user.')).toBeUndefined();
    expect(resolveAskUserAnswers({ askUserAnswers: { Scope: 42 } as any }, '')).toBeUndefined();
  });
});

describe('summarizeAskUserAnswers', () => {
  const questions: AskUserQuestionItem[] = [
    { header: 'Audience', options: [{ label: 'Owners' }], question: 'Who?' },
    { header: 'Content', multiSelect: true, options: [], question: 'What?' },
    { header: 'Schedule', options: [], question: 'When?' },
  ];

  it('leads with the first answer and counts the remaining questions', () => {
    expect(summarizeAskUserAnswers(questions, { 'What?': ['Runs'], 'Who?': 'Owners' })).toBe(
      'Owners +2',
    );
  });

  it('joins a multi-select answer', () => {
    expect(summarizeAskUserAnswers([questions[1]], { 'What?': ['Runs', 'Credits'] })).toBe(
      'Runs, Credits',
    );
  });

  it('shows option labels for provider-owned option ids', () => {
    expect(
      summarizeAskUserAnswers(
        [{ header: 'Edit', options: [{ id: 'allow-once', label: 'Allow' }], question: 'Edit?' }],
        { 'Edit?': 'allow-once' },
      ),
    ).toBe('Allow');
  });

  it('shows a note-only answer as written', () => {
    expect(summarizeAskUserAnswers(questions, { __freeform__: 'Hold off for now.' })).toBe(
      'Hold off for now.',
    );
  });

  it('returns nothing before an answer exists', () => {
    expect(summarizeAskUserAnswers(questions, undefined)).toBeUndefined();
    expect(summarizeAskUserAnswers(questions, { __supplement__: 'Only a note' })).toBeUndefined();
  });
});
