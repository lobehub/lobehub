import { describe, expect, it } from 'vitest';

import { hasNonPersistedMessage } from '../messagePersistence';

describe('hasNonPersistedMessage', () => {
  it('is false when every message has a DB id', () => {
    expect(
      hasNonPersistedMessage([
        { content: 'hi', id: 'm1', role: 'user' },
        { content: 'yo', id: 'm2', role: 'assistant' },
      ]),
    ).toBe(false);
  });

  it('is true when a message has no id (ephemeral / suppressed)', () => {
    expect(
      hasNonPersistedMessage([
        { content: 'persisted', id: 'm1', role: 'user' },
        // group-member supervisor instruction — never written to the DB
        { content: 'respond to the group', role: 'user' },
      ]),
    ).toBe(true);
  });

  it('is false for non-array / empty / nullish inputs', () => {
    expect(hasNonPersistedMessage(undefined)).toBe(false);
    expect(hasNonPersistedMessage(null)).toBe(false);
    expect(hasNonPersistedMessage([])).toBe(false);
    expect(hasNonPersistedMessage('nope')).toBe(false);
  });

  it('ignores malformed entries without a role', () => {
    expect(hasNonPersistedMessage([{ content: 'x' }, null, undefined])).toBe(false);
  });
});
