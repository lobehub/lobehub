import { describe, expect, it } from 'vitest';

import { sharedAgentDisplayName } from './displayName';

describe('sharedAgentDisplayName', () => {
  it('prefers the user-facing agent name over its role title', () => {
    expect(sharedAgentDisplayName({ name: 'Alice', title: 'Research Assistant' })).toBe('Alice');
  });

  it('falls back to the role title for agents without a name', () => {
    expect(sharedAgentDisplayName({ name: null, title: 'Research Assistant' })).toBe(
      'Research Assistant',
    );
  });
});
