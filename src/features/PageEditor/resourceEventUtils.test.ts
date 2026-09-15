import { describe, expect, it } from 'vitest';

import { shouldIgnoreResourceEvent } from './resourceEventUtils';

describe('shouldIgnoreResourceEvent', () => {
  it('allows same-user comment events to refresh another window', () => {
    expect(
      shouldIgnoreResourceEvent({ actorId: 'user-1', type: 'document.commentsChanged' }, 'user-1'),
    ).toBe(false);
    expect(
      shouldIgnoreResourceEvent({ actorId: 'user-1', type: 'document.likesChanged' }, 'user-1'),
    ).toBe(false);
  });

  it('continues to suppress other same-user resource echoes', () => {
    expect(shouldIgnoreResourceEvent({ actorId: 'user-1', type: 'doc.updated' }, 'user-1')).toBe(
      true,
    );
    expect(shouldIgnoreResourceEvent({ actorId: 'user-2', type: 'doc.updated' }, 'user-1')).toBe(
      false,
    );
  });
});
