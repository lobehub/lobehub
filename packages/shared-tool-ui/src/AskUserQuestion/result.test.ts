import { describe, expect, it } from 'vitest';

import { resolveAskUserAnswers } from './result';

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
