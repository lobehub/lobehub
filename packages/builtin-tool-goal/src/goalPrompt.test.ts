import { describe, expect, it } from 'vitest';

import { isGoalPrompt } from './goalPrompt';

describe('isGoalPrompt', () => {
  it.each(['/goal ship it', '  /goal\nship it', '/GOAL ship it'])('matches %j', (prompt) => {
    expect(isGoalPrompt(prompt)).toBe(true);
  });

  it.each(['/goals ship it', 'please /goal ship it', '', undefined])(
    'does not match %j',
    (prompt) => {
      expect(isGoalPrompt(prompt)).toBe(false);
    },
  );
});
