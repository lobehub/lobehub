import { describe, expect, it } from 'vitest';

import { normalizeAskUserQuestions } from './normalize';

describe('normalizeAskUserQuestions', () => {
  it('keeps valid question arrays', () => {
    const questions = normalizeAskUserQuestions({
      questions: [
        {
          header: 'Scope',
          multiSelect: true,
          options: [
            { description: 'Fix the crash only', label: 'Narrow' },
            { description: 'Also harden related renderers', label: 'Full' },
          ],
          question: 'How broad should the fix be?',
        },
      ],
    });

    expect(questions).toEqual([
      {
        header: 'Scope',
        multiSelect: true,
        options: [
          { description: 'Fix the crash only', label: 'Narrow' },
          { description: 'Also harden related renderers', label: 'Full' },
        ],
        question: 'How broad should the fix be?',
      },
    ]);
  });

  it('accepts a single question object for stale payloads', () => {
    const questions = normalizeAskUserQuestions({
      questions: {
        header: 'Mode',
        options: [{ label: 'Auto' }, { description: 'Manual path', label: 'Manual' }],
        question: 'Which mode?',
      },
    });

    expect(questions).toEqual([
      {
        header: 'Mode',
        options: [{ label: 'Auto' }, { description: 'Manual path', label: 'Manual' }],
        question: 'Which mode?',
      },
    ]);
  });

  it('drops malformed question payloads instead of returning non-arrays', () => {
    expect(normalizeAskUserQuestions({ questions: 'not-json' })).toEqual([]);
    expect(normalizeAskUserQuestions({ questions: null })).toEqual([]);
    expect(normalizeAskUserQuestions({ questions: [{ options: [], question: 42 }] })).toEqual([]);
  });

  it('parses stringified args or questions from double-encoded payloads', () => {
    const expected = [
      {
        header: 'Mode',
        options: [{ label: 'Auto' }],
        question: 'Which mode?',
      },
    ];

    expect(
      normalizeAskUserQuestions(
        JSON.stringify({
          questions: expected,
        }),
      ),
    ).toEqual(expected);
    expect(normalizeAskUserQuestions({ questions: JSON.stringify(expected) })).toEqual(expected);
  });

  it('normalizes malformed options so renderers can map safely', () => {
    const questions = normalizeAskUserQuestions({
      questions: [
        {
          header: 123,
          multiSelect: 'yes',
          options: [{ label: 'Keep' }, { description: 'missing label' }, null],
          question: 'Pick one',
        },
      ],
    });

    expect(questions).toEqual([
      {
        header: '',
        options: [{ label: 'Keep' }],
        question: 'Pick one',
      },
    ]);
  });
});
